// Workspace metadata and boundary guard. Production readiness (ADR-0009) requires
// every package.json to carry a description, every library to expose typed exports,
// and the workspace member count to stay in sync with the architecture map. This
// runs in the gate (pnpm test) so a new package cannot silently ship without
// metadata or quietly change the count the docs assert. (ADR-0009.)

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

interface PackageJson {
  readonly name?: string;
  readonly description?: string;
  readonly exports?: unknown;
  readonly types?: string;
  readonly bin?: unknown;
}

async function readPackages(group: 'packages' | 'apps'): Promise<{ dir: string; pkg: PackageJson }[]> {
  const base = join(repoRoot, group);
  const entries = await readdir(base, { withFileTypes: true });
  const out: { dir: string; pkg: PackageJson }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const raw = await readFile(join(base, e.name, 'package.json'), 'utf8');
    out.push({ dir: e.name, pkg: JSON.parse(raw) as PackageJson });
  }
  return out;
}

describe('workspace metadata', () => {
  it('every package and app declares a name and a non-empty description', async () => {
    const all = [...(await readPackages('packages')), ...(await readPackages('apps'))];
    const missing = all.filter((p) => !p.pkg.name || !p.pkg.description?.trim()).map((p) => p.dir);
    expect(missing, `missing name/description in: ${missing.join(', ')}`).toEqual([]);
  });

  it('every library package exposes typed exports', async () => {
    const libs = await readPackages('packages');
    const broken = libs.filter((p) => !p.pkg.exports || !p.pkg.types).map((p) => p.pkg.name ?? p.dir);
    expect(broken, `library packages missing exports/types: ${broken.join(', ')}`).toEqual([]);
  });

  it('holds the architecture package count (29 packages, 4 apps) so additions are deliberate', async () => {
    const libs = await readPackages('packages');
    const apps = await readPackages('apps');
    // 29 = the 27 of the pre-merge architecture plus the two Session 3 seam
    // packages of ADR M-0002: cspice-wasm (extracted from the spice layer,
    // which remains as a facade) and @cosmolabe/frames.
    expect(libs.length).toBe(29);
    expect(apps.length).toBe(4);
    // The headless automation, OD, and seam additions must be present.
    const names = new Set(libs.map((p) => p.pkg.name));
    for (const required of [
      '@bessel/sdk',
      '@bessel/od',
      '@bessel/pal-node',
      'cspice-wasm',
      '@cosmolabe/frames',
    ]) {
      expect(names.has(required), `expected workspace to include ${required}`).toBe(true);
    }
  });
});
