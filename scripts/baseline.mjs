#!/usr/bin/env node
/**
 * baseline: capture or compare the pre-repoint golden baselines (Session 2,
 * Iron rule 5). Root-owned; touches nothing in the cosmolabe heritage tree.
 *
 * Two baseline families live under tests/golden/pre-merge/:
 *
 *   fingerprints/  deterministic numeric scene fingerprints, produced by the
 *                  heritage harness (packages/core __tests__/_harness) via the
 *                  root rig (tests/rig/capture-fingerprints.rig.ts). These are
 *                  byte-for-byte reproducible under the pinned environment.
 *   renders/       PNG frames of the built viewer captured in headless
 *                  Chromium with SwiftShader software WebGL, one per scene and
 *                  viewpoint, same mechanism and thresholds as the heritage
 *                  Layer 4 script (cosmolabe/scripts/visual-regression.mjs).
 *                  Byte-identical on one machine; across machines the compare
 *                  gates on pixelmatch, not bytes.
 *
 * Usage:
 *   node scripts/baseline.mjs capture   (re)write tests/golden/pre-merge/
 *   node scripts/baseline.mjs compare   recapture to a temp dir and diff
 *
 * Flags: --skip-build (reuse the existing viewer dist), --renders-only,
 * --fingerprints-only.
 *
 * The pinned capture environment (TZ, node, versions) is recorded to
 * environment.json on capture and asserted here at startup: the TZ pin exists
 * because naked epoch strings parse as local time in the cosmolabe path (see
 * the named finding in docs/collab/RE-ENTRY-BRIEF.md).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CL = join(ROOT, 'cosmolabe');
const BASELINE = join(ROOT, 'tests/golden/pre-merge');
const PINNED_TZ = 'America/Los_Angeles';

// Render capture parameters: identical to the heritage Layer 4 script so the
// two mechanisms stay comparable.
const VIEWPORT = { width: 1024, height: 768 };
const THRESHOLD = 0.1;
const MAX_DIFF_FRAC = 0.005;
const SETTLE_MS = Number(process.env.VR_SETTLE_MS ?? 6000);
const PORT = 4173;
// Scene list mirrors SCENES in cosmolabe/scripts/visual-regression.mjs.
const RENDER_SCENES = [
  { catalog: 'cassini-soi', viewpoints: ['SOI (2004-07-01)', 'Ring Plane View'] },
  { catalog: 'earth-moon', viewpoints: [] },
];

const mode = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (mode !== 'capture' && mode !== 'compare') {
  console.error('usage: node scripts/baseline.mjs capture|compare [--skip-build] [--renders-only] [--fingerprints-only]');
  process.exit(2);
}
if (process.env.TZ !== PINNED_TZ) {
  console.error(`baseline: TZ must be pinned: run with TZ=${PINNED_TZ} (got ${process.env.TZ ?? 'unset'})`);
  process.exit(2);
}
// Compare must run on the exact node the baselines were captured with: the
// byte-for-byte fingerprint claim depends on it. Capture defines the
// environment; compare asserts it.
if (mode === 'compare') {
  const envPath = join(BASELINE, 'environment.json');
  if (!existsSync(envPath)) {
    console.error(`baseline: ${envPath} is missing; cannot verify the pinned capture environment`);
    process.exit(2);
  }
  const pinned = JSON.parse(readFileSync(envPath, 'utf-8'));
  if (pinned.node !== process.version) {
    console.error(
      `baseline: node ${process.version} does not match the pinned capture environment ` +
        `(${pinned.node} in environment.json). Byte-for-byte comparison requires the exact ` +
        `node version; see tests/golden/pre-merge/ENVIRONMENT.md for how to obtain it.`,
    );
    process.exit(2);
  }
}

const require_ = createRequire(join(CL, 'apps/viewer/package.json'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Dependencies come from the cosmolabe tree (the root has no node_modules).
// require.resolve can land on a CJS entry where named exports sit behind the
// default interop, hence the explicit fallbacks.
async function viewerDep(name, exportName) {
  const mod = await import(pathToFileURL(require_.resolve(name)));
  if (!exportName) return mod.default ?? mod;
  return mod[exportName] ?? mod.default?.[exportName] ?? mod.default;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

// ── fingerprints ─────────────────────────────────────────────────────────────

async function captureFingerprints(outDir) {
  const vitest = join(CL, 'node_modules/vitest/vitest.mjs');
  await run(process.execPath, [vitest, 'run', '--config', 'tests/rig/vitest.config.mjs', 'capture-fingerprints'], {
    env: { ...process.env, RIG_OUT: outDir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

// ── renders ──────────────────────────────────────────────────────────────────

async function withViewer(fn) {
  if (!flags.has('--skip-build')) {
    console.log('[baseline] building viewer');
    await run('npm', ['--prefix', join(CL, 'apps/viewer'), 'run', 'build'], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const server = spawn('npm', ['--prefix', join(CL, 'apps/viewer'), 'run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  try {
    const url = `http://localhost:${PORT}`;
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        if ((await fetch(url)).ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('viewer preview server did not come up');
      await new Promise((r) => setTimeout(r, 300));
    }
    return await fn(url);
  } finally {
    server.kill();
  }
}

async function captureRenders(outDir) {
  const chromium = await viewerDep('playwright', 'chromium');
  const PNG = await viewerDep('pngjs', 'PNG');
  mkdirSync(outDir, { recursive: true });
  await withViewer(async (baseUrl) => {
    const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, timezoneId: PINNED_TZ });
      const page = await ctx.newPage();
      for (const scene of RENDER_SCENES) {
        console.log(`[baseline] scene ${scene.catalog}`);
        await page.goto(`${baseUrl}/?catalog=${encodeURIComponent(scene.catalog)}&test=1`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__cosmolabe?.ready === true, { timeout: 120000 });
        await page.waitForTimeout(SETTLE_MS);
        for (const vp of scene.viewpoints.length ? scene.viewpoints : [null]) {
          const label = `${scene.catalog}${vp ? `--${vp}` : ''}`.replace(/[^\w.-]+/g, '_');
          const dataUrl = await page.evaluate((name) => window.__cosmolabe.capture(name ?? undefined), vp);
          const png = PNG.sync.read(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
          writeFileSync(join(outDir, `${label}.png`), PNG.sync.write(png));
          console.log(`  wrote ${label}.png`);
        }
      }
    } finally {
      await browser.close();
    }
  });
}

async function compareRenders(actualDir, goldenDir, failures) {
  const pixelmatch = await viewerDep('pixelmatch');
  const PNG = await viewerDep('pngjs', 'PNG');
  {
    for (const name of readdirSync(goldenDir).filter((f) => f.endsWith('.png')).sort()) {
      const gBuf = readFileSync(join(goldenDir, name));
      const aPath = join(actualDir, name);
      if (!existsSync(aPath)) {
        failures.push(`${name}: missing from recapture`);
        continue;
      }
      const aBuf = readFileSync(aPath);
      const bytes = gBuf.equals(aBuf) ? 'byte-identical' : 'bytes differ';
      const golden = PNG.sync.read(gBuf);
      const actual = PNG.sync.read(aBuf);
      if (golden.width !== actual.width || golden.height !== actual.height) {
        failures.push(`${name}: size mismatch`);
        continue;
      }
      const nDiff = pixelmatch(golden.data, actual.data, null, golden.width, golden.height, { threshold: THRESHOLD });
      const frac = nDiff / (golden.width * golden.height);
      if (frac > MAX_DIFF_FRAC) {
        failures.push(`${name}: ${(frac * 100).toFixed(3)}% pixels differ (gate ${(MAX_DIFF_FRAC * 100).toFixed(2)}%)`);
      } else {
        console.log(`  ok ${name} (${(frac * 100).toFixed(3)}% diff, ${bytes})`);
      }
    }
  }
}

// ── checksums and environment ────────────────────────────────────────────────

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function writeChecksums() {
  const lines = [];
  for (const p of walk(BASELINE)) {
    const rel = relative(BASELINE, p);
    if (rel === 'SHA256SUMS' || rel === 'ENVIRONMENT.md') continue;
    lines.push(`${sha256(readFileSync(p))}  ${rel}`);
  }
  writeFileSync(join(BASELINE, 'SHA256SUMS'), lines.join('\n') + '\n');
  console.log(`[baseline] wrote SHA256SUMS (${lines.length} files)`);
}

function verifyChecksums(failures) {
  const sums = readFileSync(join(BASELINE, 'SHA256SUMS'), 'utf-8').trim().split('\n');
  for (const line of sums) {
    const [sum, rel] = line.split(/  /);
    const p = join(BASELINE, rel);
    if (!existsSync(p)) failures.push(`SHA256SUMS: ${rel} missing`);
    else if (sha256(readFileSync(p)) !== sum) failures.push(`SHA256SUMS: ${rel} hash mismatch`);
  }
  console.log(`[baseline] checksums verified (${sums.length} files)`);
}

async function chromiumVersion() {
  const chromium = await viewerDep('playwright', 'chromium');
  const b = await chromium.launch();
  const v = b.version();
  await b.close();
  return v;
}

async function writeEnvironment() {
  const env = {
    capturedAt: new Date().toISOString(),
    tz: PINNED_TZ,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    playwright: require_('playwright/package.json').version,
    chromium: await chromiumVersion(),
    webgl: 'SwiftShader (software), --use-gl=swiftshader',
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    pixelmatch: { threshold: THRESHOLD, maxDiffFraction: MAX_DIFF_FRAC },
    settleMs: SETTLE_MS,
  };
  writeFileSync(join(BASELINE, 'environment.json'), JSON.stringify(env, null, 2) + '\n');
  console.log('[baseline] wrote environment.json');
}

// ── main ─────────────────────────────────────────────────────────────────────

const doFingerprints = !flags.has('--renders-only');
const doRenders = !flags.has('--fingerprints-only');

if (mode === 'capture') {
  if (doFingerprints) await captureFingerprints(join(BASELINE, 'fingerprints'));
  if (doRenders) await captureRenders(join(BASELINE, 'renders'));
  await writeEnvironment();
  writeChecksums();
  console.log('[baseline] capture complete: review and commit tests/golden/pre-merge/');
} else {
  const failures = [];
  const tmp = join(tmpdir(), `baseline-compare-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  if (doFingerprints) {
    await captureFingerprints(join(tmp, 'fingerprints'));
    const goldenDir = join(BASELINE, 'fingerprints');
    for (const name of readdirSync(goldenDir).sort()) {
      const g = readFileSync(join(goldenDir, name));
      const aPath = join(tmp, 'fingerprints', name);
      if (!existsSync(aPath)) failures.push(`fingerprints/${name}: missing from recapture`);
      else if (!g.equals(readFileSync(aPath))) failures.push(`fingerprints/${name}: bytes differ`);
      else console.log(`  ok fingerprints/${name} (byte-identical)`);
    }
  }
  if (doRenders) {
    await captureRenders(join(tmp, 'renders'));
    await compareRenders(join(tmp, 'renders'), join(BASELINE, 'renders'), failures);
  }
  verifyChecksums(failures);
  rmSync(tmp, { recursive: true, force: true });
  if (failures.length) {
    console.error('\n[baseline] COMPARE FAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\n[baseline] compare: captured baselines reproduce.');
}
