#!/usr/bin/env node
/**
 * seam: run the Session 3 differential harness (tests/rig/seam.rig.ts) under
 * the pinned environment and summarize the deltas against the M-0002 gates.
 * Machine-readable output: docs/validation/data/seam-call-parity.json and
 * docs/validation/data/seam-pipeline.json.
 *
 * Exit semantics mirror iron rule 3: a call-parity breach (relative 1e-12)
 * fails the rig itself and therefore this script. Pipeline deltas are
 * tripwires (1 m position, 5 arcsec pointing): reported honestly, they gate
 * the re-point, not this script, unless --strict-pipeline is passed (the
 * Session 4 mode).
 *
 * Usage: TZ=America/Los_Angeles node scripts/seam.mjs [--strict-pipeline]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.RIG_OUT ?? join(ROOT, 'docs/validation/data');
const STRICT_PIPELINE = process.argv.includes('--strict-pipeline');

if (process.env.TZ !== 'America/Los_Angeles') {
  console.error('seam: run with TZ=America/Los_Angeles (the pinned capture environment)');
  process.exit(2);
}

const res = spawnSync(
  process.execPath,
  [join(ROOT, 'cosmolabe/node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/rig/vitest.config.mjs', 'seam'],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, RIG_OUT: OUT } },
);
if (res.status !== 0) {
  console.error('seam: the rig failed; if call-parity rows are red, the seam gate is red (iron rule 3).');
  process.exit(res.status ?? 1);
}

const table = (name) => JSON.parse(readFileSync(join(OUT, name), 'utf-8'));
const print = (rows, cols) => {
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
  console.log(cols.map((c) => c.padEnd(width[c])).join('  '));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join('  '));
};

const parity = table('seam-call-parity.json');
console.log(`== call-parity (gate: relative ${parity.gateRelative}) ==`);
console.log(`toolkits: cosmolabe ${parity.toolkit.cosmolabe}, cspice-wasm ${parity.toolkit.cspiceWasm}`);
print(parity.rows, ['scenario', 'call', 'detail', 'correction', 'epochs', 'maxRelDelta', 'pass']);
console.log(parity.allPass ? 'call-parity: GREEN on GS-1 and GS-2.' : 'call-parity: RED.');

const pipeline = table('seam-pipeline.json');
console.log(`\n== pipeline (tripwires: ${pipeline.tripwires.positionM} m position, ${pipeline.tripwires.pointingArcsec} arcsec pointing) ==`);
print(pipeline.rows, ['scenario', 'body', 'center', 'maxPosErrM', 'pointErrArcsec', 'posWithinTripwire', 'pointWithinTripwire']);
if (pipeline.allWithinTripwires) {
  console.log('pipeline: within tripwires on every row (green precondition for the re-point met).');
} else {
  const out = pipeline.rows.filter((r) => !r.posWithinTripwire || r.pointWithinTripwire === false);
  console.log(`pipeline: ${out.length} row(s) outside the tripwires (${out.map((r) => `${r.scenario} ${r.body}`).join('; ')}).`);
  console.log('This gates the re-point, not this session; see the table description for the named finding.');
}

console.log(`\ntables: ${join(OUT, 'seam-call-parity.json')}, ${join(OUT, 'seam-pipeline.json')}`);
if (STRICT_PIPELINE && !pipeline.allWithinTripwires) process.exit(1);
if (!parity.allPass) process.exit(1);
