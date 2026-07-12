#!/usr/bin/env node
/**
 * horizons: run the nightly Horizons spot-check rig (tests/rig/horizons.rig.ts)
 * and summarize the deltas against the per-body physical-agreement bounds.
 * Machine-readable output: docs/validation/data/horizons-spot-check.json.
 *
 * Exit semantics (design 04 risk nine, honestly): a tolerance breach fails
 * the rig and therefore this script (exit 1, the real alarm). An unreachable
 * Horizons is a named skip: the table records status skipped-unreachable,
 * the rig passes, and this script prints a workflow notice and exits 0, so
 * the nightly lane never trains alarm fatigue on network weather and never
 * pretends a run happened. Any other rig failure (an API contract surprise,
 * a missing kernel) is a real failure and exits nonzero.
 *
 * No TZ pin: unlike the seam rig, this rig touches no cosmolabe harness code
 * and every epoch string parses through the frames tier (str2et, UTC).
 *
 * Usage: node scripts/horizons.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.RIG_OUT ?? join(ROOT, 'docs/validation/data');

const res = spawnSync(
  process.execPath,
  [
    join(ROOT, 'cosmolabe/node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'tests/rig/vitest.config.mjs',
    'horizons',
  ],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, RIG_OUT: OUT } },
);
if (res.status !== 0) {
  console.error('horizons: the rig failed; if delta rows are red, frames-tier states disagree with Horizons (the real alarm).');
  process.exit(res.status ?? 1);
}

const table = JSON.parse(readFileSync(join(OUT, 'horizons-spot-check.json'), 'utf-8'));

if (table.status === 'skipped-unreachable') {
  // The GitHub Actions notice annotation; harmless noise on a local run.
  console.log(`::notice title=Horizons spot-check skipped::service unreachable: ${table.reason}`);
  console.log(`horizons: SKIPPED (unreachable: ${table.reason}); no states were compared.`);
  process.exit(0);
}

const cols = ['lane', 'target', 'epochUtc', 'dPosKm', 'dVelKmS', 'tolPosKm', 'tolVelKmS', 'pass', 'horizonsSource'];
const rows = table.rows.map((r) => ({
  ...r,
  dPosKm: r.dPosKm.toFixed(6),
  dVelKmS: r.dVelKmS.toExponential(3),
}));
const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
console.log('== horizons spot-check (external truth; per-body physical-agreement bounds) ==');
console.log(cols.map((c) => c.padEnd(width[c])).join('  '));
for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join('  '));
console.log(table.allPass ? 'horizons: GREEN on every row.' : 'horizons: RED.');
console.log(`table: ${join(OUT, 'horizons-spot-check.json')}`);
process.exit(table.allPass ? 0 : 1);
