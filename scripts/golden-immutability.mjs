#!/usr/bin/env node
/**
 * golden-immutability: the mechanical form of CLAUDE.md rule 5's "immutable
 * history" for tests/golden/pre-merge/. The directory's git tree hash is
 * pinned outside it, in tests/golden/PRE-MERGE-TREE; this gate fails `pnpm
 * verify` if the committed tree drifts from the pin or the working copy
 * carries any change (staged, unstaged, or untracked) under the directory.
 *
 * A legitimate amendment to the baseline record is an explicit, reviewed edit
 * of the pin file; a new baseline set (for example the Session 3 re-point
 * re-baseline) goes in a sibling directory and never touches this one.
 *
 * Usage: node scripts/golden-immutability.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'tests/golden/pre-merge';
const PIN_FILE = join(ROOT, 'tests/golden/PRE-MERGE-TREE');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();

const pinned = readFileSync(PIN_FILE, 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l && !l.startsWith('#'));
if (!pinned || !/^[0-9a-f]{40}$/.test(pinned)) {
  console.error(`golden-immutability: no valid tree hash found in ${PIN_FILE}`);
  process.exit(2);
}

let committed;
try {
  committed = git('rev-parse', `HEAD:${DIR}`);
} catch {
  console.error(`golden-immutability: cannot resolve HEAD:${DIR}; the baseline directory must exist in the committed tree`);
  process.exit(2);
}
if (committed !== pinned) {
  console.error(
    `golden-immutability: ${DIR} has drifted (rule 5).\n` +
      `  pinned tree:    ${pinned} (tests/golden/PRE-MERGE-TREE)\n` +
      `  committed tree: ${committed} (HEAD)\n` +
      `The pre-merge baselines are immutable history; a re-baseline goes in a sibling directory. ` +
      `If this is a deliberate, reviewed amendment of the record itself, update the pin file in the same commit.`,
  );
  process.exit(1);
}

const dirty = git('status', '--porcelain', '--', DIR);
if (dirty) {
  console.error(
    `golden-immutability: uncommitted changes under ${DIR} (rule 5):\n` +
      dirty.split('\n').map((l) => '  ' + l).join('\n'),
  );
  process.exit(1);
}

console.log(`golden-immutability: ${DIR} matches the pinned tree ${pinned.slice(0, 12)} and the working copy is clean.`);
