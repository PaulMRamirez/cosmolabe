#!/usr/bin/env node
/**
 * state-error: run the Session 2 state and orientation error rig
 * (tests/rig/state-error.rig.ts) under the pinned environment and print the
 * table. Machine-readable output: docs/validation/data/state-error.json.
 *
 * Usage: TZ=America/Los_Angeles node scripts/state-error.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.RIG_OUT ?? join(ROOT, 'docs/validation/data');

if (process.env.TZ !== 'America/Los_Angeles') {
  console.error('state-error: run with TZ=America/Los_Angeles (the pinned capture environment)');
  process.exit(2);
}

const res = spawnSync(
  process.execPath,
  [join(ROOT, 'cosmolabe/node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/rig/vitest.config.mjs', 'state-error'],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, RIG_OUT: OUT } },
);
if (res.status !== 0) process.exit(res.status ?? 1);

const { rows } = JSON.parse(readFileSync(join(OUT, 'state-error.json'), 'utf-8'));
const cols = ['body', 'center', 'maxPosErrM', 'poleErrArcsec'];
const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
console.log(cols.map((c) => c.padEnd(width[c])).join('  '));
for (const r of rows) {
  console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join('  '));
}
console.log(`\ntable: ${join(OUT, 'state-error.json')}`);
