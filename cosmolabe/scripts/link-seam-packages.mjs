#!/usr/bin/env node
// Link the seam packages of the merged monorepo (ADR M-0002) into this npm
// tree: @cosmolabe/frames and cspice-wasm live in the bessel pnpm workspace
// at ../bessel/packages, and the two trees keep separate installs until the
// packages/ restructure, so a postinstall symlink is the bridge. npm ci wipes
// node_modules and then runs this hook, so the links survive reinstalls.
// Consumers resolve the packages' built dist through their exports maps;
// build them with `pnpm -C ../bessel build:seam` (the root `pnpm verify`
// does this inside the bessel gate before any cosmolabe step runs).
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cosmolabeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const besselPackages = resolve(cosmolabeRoot, '../bessel/packages');

const LINKS = [
  { from: join(cosmolabeRoot, 'node_modules/@cosmolabe/frames'), to: join(besselPackages, 'frames') },
  { from: join(cosmolabeRoot, 'node_modules/cspice-wasm'), to: join(besselPackages, 'cspice-wasm') },
];

if (!existsSync(besselPackages)) {
  // A standalone cosmolabe checkout (the heritage repo of record) has no
  // bessel sibling; the seam consumers only exist in the merged monorepo,
  // so there is nothing to link and nothing to fail.
  console.log('link-seam-packages: no ../bessel tree; skipping (standalone cosmolabe checkout).');
  process.exit(0);
}

for (const { from, to } of LINKS) {
  mkdirSync(dirname(from), { recursive: true });
  rmSync(from, { recursive: true, force: true });
  symlinkSync(relative(dirname(from), to), from, 'dir');
  console.log(`link-seam-packages: ${relative(cosmolabeRoot, from)} -> ${to}`);
}
