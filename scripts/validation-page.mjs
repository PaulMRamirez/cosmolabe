#!/usr/bin/env node
/**
 * validation-page: assemble the public validation page skeleton
 * (docs/validation/index.html) from the committed machine-readable tables in
 * docs/validation/data/. The page is self-contained (inline data, no fetch),
 * deterministic (no timestamps; provenance lives in the tables and the git
 * history), and honest: every table carries its gate and the command that
 * reproduces it, and future scope is named as future scope.
 *
 * Usage: node scripts/validation-page.mjs   (rerun after tables change)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs/validation/data');
const OUT = join(ROOT, 'docs/validation/index.html');

const table = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf-8'));

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cell = (v) => {
  if (v === null || v === undefined) return '<td class="na">null</td>';
  if (typeof v === 'boolean') {
    return v ? '<td class="pass">true</td>' : '<td class="fail">false</td>';
  }
  return `<td>${esc(v)}</td>`;
};

function renderRows(rows, columns) {
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${columns.map((c) => cell(r[c])).join('')}</tr>`)
    .join('\n');
  return `<table>\n<tr>${head}</tr>\n${body}\n</table>`;
}

const parity = table('seam-call-parity.json');
const pipeline = table('seam-pipeline.json');
const stateError = table('state-error.json');
const jitter = table('jitter.json');
const horizons = table('horizons-spot-check.json');

const horizonsSection =
  horizons.status === 'skipped-unreachable'
    ? `<p class="gate">The committed snapshot records a named skip (Horizons was
unreachable when it was last generated: ${esc(horizons.reason)}); the badge
above reflects the latest nightly run, and the next session refreshes this
snapshot.</p>`
    : `<div class="scroll">
${renderRows(
  horizons.rows.map((r) => ({
    ...r,
    dPosKm: Number(r.dPosKm).toFixed(6),
    dVelKmS: Number(r.dVelKmS).toExponential(3),
  })),
  ['lane', 'target', 'observer', 'epochUtc', 'dPosKm', 'dVelKmS', 'tolPosKm', 'tolVelKmS', 'pass', 'horizonsSource'],
)}
</div>`;

const badge = parity.allPass && pipeline.allWithinTripwires
  ? '<span class="pass">GREEN</span>'
  : '<span class="fail">RED</span>';

const html = `<!doctype html>
<meta charset="utf-8">
<title>Cosmolabe validation</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2.2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92em; }
  th, td { border: 1px solid #8888; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #8882; position: sticky; top: 0; }
  code { font-family: ui-monospace, monospace; font-size: 0.92em; }
  .pass { color: #1a7f37; font-weight: 600; } .fail { color: #cf222e; font-weight: 600; }
  .na { color: #888; }
  .gate { border-left: 3px solid #888; padding: 0.4rem 1rem; background: #8881; margin: 0.6rem 0; }
  .scroll { overflow-x: auto; }
</style>

<h1>Cosmolabe validation report</h1>
<p class="gate">This page belongs to the merged
<a href="https://github.com/PaulMRamirez/bessel">Bessel</a> +
<a href="https://github.com/AaronPlave/cosmolabe">Cosmolabe</a> project, a
work in progress combining Aaron Plave's Cosmolabe (visualization engine and
instrument; see his <a href="https://aaronplave.com/cosmolabe/">heritage
demo</a>) with Bessel (compute engines, SDK, and CLI). Both parents are
Apache 2.0; the merged repository is
<a href="https://github.com/PaulMRamirez/cosmolabe">PaulMRamirez/cosmolabe</a>.</p>
<p>Capability claims point here and nowhere else. Everything on this page is
generated from the committed machine-readable tables in
<code>docs/validation/data/</code> by <code>node scripts/validation-page.mjs</code>;
each table names its gate and the command that reproduces it under the pinned
environment (<code>TZ=America/Los_Angeles</code>, node 22). The adversarial
per-session cross-checks live in <a href="reports/session-2.html">the
verify-spec reports</a> (<a href="reports/session-3.html">3</a>,
<a href="reports/session-4.html">4</a>, <a href="reports/session-5.html">5</a>).</p>

<p class="gate"><strong>Differential harness (ADR M-0002):</strong> ${badge}.
Call-parity ${parity.allPass ? 'passes' : 'FAILS'} on all four golden scenarios at
relative ${esc(parity.gateRelative)}; pipeline mode is
${pipeline.allWithinTripwires ? 'within' : 'OUTSIDE'} the ${esc(pipeline.tripwires.positionM)} m
position and ${esc(pipeline.tripwires.pointingArcsec)} arcsec pointing tripwires on every row.
Toolkits: cosmolabe ${esc(parity.toolkit.cosmolabe)}, cspice-wasm ${esc(parity.toolkit.cspiceWasm)}.</p>

<h2>Seam call-parity (gate: relative ${esc(parity.gateRelative)})</h2>
<p>${esc(parity.description)}</p>
<p>Reproduce: <code>TZ=America/Los_Angeles node scripts/seam.mjs --strict-pipeline</code></p>
<div class="scroll">
${renderRows(parity.rows, ['scenario', 'call', 'detail', 'correction', 'epochs', 'maxRelDelta', 'pass'])}
</div>

<h2>Seam pipeline (tripwires: ${esc(pipeline.tripwires.positionM)} m position, ${esc(pipeline.tripwires.pointingArcsec)} arcsec pointing)</h2>
<p>${esc(pipeline.description)}</p>
<p>Reproduce: <code>TZ=America/Los_Angeles node scripts/seam.mjs --strict-pipeline</code></p>
<div class="scroll">
${renderRows(pipeline.rows, ['scenario', 'body', 'center', 'correction', 'frame', 'epochs', 'maxPosErrM', 'pointErrArcsec', 'posWithinTripwire', 'pointWithinTripwire'])}
</div>

<h2>State and orientation error vs SPICE truth</h2>
<p>${esc(stateError.description)}</p>
<p>Reproduce: <code>TZ=America/Los_Angeles node scripts/state-error.mjs</code></p>
<div class="scroll">
${renderRows(stateError.rows, ['body', 'center', 'correction', 'epochs', 'maxPosErrKm', 'maxPosErrM', 'poleErrDeg', 'poleErrArcsec'])}
</div>

<h2>Screen-space jitter (envelope: ${esc(jitter.envelopePx)} device px on gated modes)</h2>
<p>${esc(jitter.description)}</p>
<p>Reproduce: <code>TZ=America/Los_Angeles node scripts/jitter-scaffold.mjs</code></p>
<div class="scroll">
${renderRows(jitter.rows, ['scenario', 'target', 'originMode', 'tier', 'absMaxPx', 'frameJitterMaxPx', 'gated', 'pass'])}
</div>

<h2>Horizons spot-check (external truth, nightly)</h2>
<p><a href="https://github.com/PaulMRamirez/cosmolabe/actions/workflows/horizons-nightly.yml"><img
  src="https://github.com/PaulMRamirez/cosmolabe/actions/workflows/horizons-nightly.yml/badge.svg"
  alt="horizons-nightly status"></a></p>
<p>${esc(horizons.description ?? '')}</p>
<p>The internal lanes above prove the two SPICE paths agree with each other;
this lane proves neither has drifted from the world. Reproduce:
<code>node scripts/horizons.mjs</code> (live network). The nightly checks
and alarms; sessions refresh the committed snapshot below (its generatedAt
states when). The nightly never pushes: green runs carry the regenerated
table in the run artifact and step summary, a tolerance breach or contract
change opens the pinned tracking issue with the offending rows, an
unreachable service is a named skip, and the badge above reflects the
latest run.</p>
${horizonsSection}

<h2>Scope, stated honestly</h2>
<p>This is the skeleton of the page described in docs/validation/README.md.
Present: the M-0002 differential harness over the four golden scenarios, the
Session 2 measurement rig tables, and the nightly Horizons spot-check
(external truth over the golden-scenario kernels). Future scope, named as
such and not yet claimed: SGP4 conformance against SGP4-VER, HPOP force-model
fixtures against GMAT, OD synthetic-truth recovery, and RF closed-form
checks.</p>
`;

writeFileSync(OUT, html);
console.log(`validation-page: wrote ${OUT}`);
