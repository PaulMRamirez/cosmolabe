#!/usr/bin/env node
/**
 * purity-lint: the model-layer purity gate of CLAUDE.md rule 6, wired into the
 * root `pnpm verify`. No Svelte, React, or DOM imports in the model layer of
 * either core: violations fail the gate.
 *
 * Root-owned and dependency-free (the repository root has no node_modules):
 * a lexical scan that strips comments and string literals, then flags
 * forbidden import specifiers and bare DOM-global identifier references.
 * `typeof window` style feature detection is tolerated (it proves absence
 * without touching the DOM); any other reference is a violation.
 *
 * Audited surface, per rule 6 (core, frames, engines/*) mapped onto today's
 * pre-restructure layout:
 *   bessel/packages/*        every package except the declared DOM surfaces,
 *                            ui (widgets) and pal-web / pal-electron /
 *                            pal-capacitor (platform implementations whose job
 *                            is the platform), and except scene, bessel's
 *                            spine candidate, whose label layer and canvas
 *                            surface are DOM-coupled by design: rule 6 names
 *                            core, frames, and engines, and scene is none of
 *                            the three. Its purity is still measured (that is
 *                            bake-off evidence for M-0001): --spine-audit adds
 *                            it to the audit. pal itself and pal-node stay
 *                            audited: services only, no DOM.
 *   cosmolabe/packages/core  the zero-render universe model (the spine
 *                            candidate); the render packages are exempt by
 *                            construction, the renderer is DOM territory.
 * Test files are excluded: purity binds the shipped model layer.
 *
 * The Session 3 seam packages, bessel/packages/cspice-wasm and
 * bessel/packages/frames (ADR M-0002), are audited mechanically, not
 * incidentally: they appear in REQUIRED_AUDIT below, so the gate fails loudly
 * if either directory goes missing from the discovered set rather than
 * silently shrinking the audit. The emscripten glue lives under
 * packages/cspice-wasm/wasm, outside src, and is a build artifact, not model
 * code; the audit binds the typed wrapper and the frames tier themselves.
 *
 * Usage: node scripts/purity-lint.mjs [--list] [--spine-audit]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SPINE_AUDIT = process.argv.includes('--spine-audit');
const BESSEL_EXEMPT = new Set(['ui', 'pal-web', 'pal-electron', 'pal-capacitor']);
if (!SPINE_AUDIT) BESSEL_EXEMPT.add('scene');
const AUDIT_DIRS = [
  ...readdirSync(join(ROOT, 'bessel/packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !BESSEL_EXEMPT.has(e.name))
    .map((e) => join('bessel/packages', e.name, 'src')),
  'cosmolabe/packages/core/src',
];

// Directories the audit must contain: the seam packages of ADR M-0002 and the
// cosmolabe spine. A rename or move that drops one of these from AUDIT_DIRS
// fails the gate instead of silently narrowing it.
const REQUIRED_AUDIT = [
  'bessel/packages/cspice-wasm/src',
  'bessel/packages/frames/src',
  'bessel/packages/compute/src',
  'cosmolabe/packages/core/src',
];
for (const dir of REQUIRED_AUDIT) {
  if (!AUDIT_DIRS.includes(dir) || !existsSync(join(ROOT, dir))) {
    console.error(`purity-lint: required audit directory missing: ${dir}`);
    process.exit(1);
  }
}

const FORBIDDEN_IMPORTS =
  /^(svelte|react|react-dom|preact|vue|solid-js|@sveltejs\/|jsdom$|happy-dom$)|\.svelte$/;
const DOM_GLOBALS = new Set([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'customElements', 'requestAnimationFrame', 'cancelAnimationFrame',
  'HTMLElement', 'HTMLCanvasElement', 'DocumentFragment',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
]);

/** Blank out comments and string literals, preserving newlines so reported
 *  line numbers stay true. Template interpolations are blanked with their
 *  templates: a coarse simplification, noted and accepted. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (c2 === '//') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c2 === '/*') {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== '*/') { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      out += q;
      let content = '';
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { content += '.'; i += 2; continue; }
        if (src[i] === '\n') out += '\n';
        content += '.';
        i++;
      }
      out += q === src[i] ? q : '';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Import specifiers survive stripping as quoted blanks, so re-scan the raw
 *  source for them: import/export ... from 'spec', import('spec'), require('spec'). */
function importSpecifiers(src) {
  const specs = [];
  const re = /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    const line = src.slice(0, m.index).split('\n').length;
    specs.push({ spec, line });
  }
  return specs;
}

function* tsFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      yield* tsFiles(p);
    } else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.(test|spec|bench)\./.test(e.name)) {
      yield p;
    }
  }
}

const violations = [];
let filesScanned = 0;

for (const dir of AUDIT_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of tsFiles(abs)) {
    filesScanned++;
    const raw = readFileSync(file, 'utf-8');
    const rel = relative(ROOT, file);

    for (const { spec, line } of importSpecifiers(raw)) {
      if (FORBIDDEN_IMPORTS.test(spec)) {
        violations.push(`${rel}:${line}: forbidden import '${spec}'`);
      }
    }

    const stripped = stripCommentsAndStrings(raw);

    // An identifier locally bound in this file (a NAIF-style coverage
    // `window` parameter, a CZML `document` packet constant) is that binding,
    // not the DOM global; mask it file-wide. A lexical scan cannot scope
    // precisely, so the mask errs toward silence for declared names while
    // bare, undeclared references stay loud.
    const declaredInFile = (id) =>
      new RegExp(
        `\\b(?:const|let|var|function|class|interface|type|enum)\\s+${id}\\b` +
          `|[(,]\\s*(?:readonly\\s+)?${id}\\s*[:,)=]`,
      ).test(stripped);
    const masked = new Map();

    const lines = stripped.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const idRe = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
      let m;
      while ((m = idRe.exec(lines[ln]))) {
        const id = m[2];
        if (!DOM_GLOBALS.has(id)) continue;
        const before = lines[ln].slice(0, m.index + m[1].length);
        if (/typeof\s+$/.test(before)) continue; // feature detection is tolerated
        const after = lines[ln].slice(m.index + m[1].length + id.length);
        if (/^\s*:/.test(after)) continue; // name position: object key, param, member
        if (!masked.has(id)) masked.set(id, declaredInFile(id));
        if (masked.get(id)) continue;
        violations.push(`${rel}:${ln + 1}: DOM global '${id}'`);
      }
    }
  }
}

if (process.argv.includes('--list')) {
  console.log(AUDIT_DIRS.join('\n'));
}
if (violations.length) {
  console.error(`purity-lint: ${violations.length} violation(s) in the model layer (rule 6):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`purity-lint: clean (${filesScanned} files across ${AUDIT_DIRS.length} audited directories).`);
