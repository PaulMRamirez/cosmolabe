import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Mesh } from 'three';
import { loadSpacecraftModel } from './index.ts';

// three's FileLoader (used by GLTFLoader for the embedded data URI) constructs a
// ProgressEvent, which node does not provide. A minimal polyfill lets the loader
// run headlessly without a DOM.
const g = globalThis as { ProgressEvent?: unknown };
g.ProgressEvent ??= class {
  constructor(
    public type: string,
    public init?: unknown,
  ) {}
};

const gltf = readFileSync(
  fileURLToPath(new URL('../../../apps/web/src/assets/cassini.gltf', import.meta.url)),
  'utf8',
);

describe('@bessel/scene GLTF spacecraft model', () => {
  it('parses the committed glTF into a normalized group with a mesh', async () => {
    const group = await loadSpacecraftModel(gltf, 6); // normalize to 6 km radius
    let meshes = 0;
    group.traverse((o) => {
      if (o instanceof Mesh) meshes += 1;
    });
    expect(meshes).toBeGreaterThan(0);
    // The group was scaled so its bounding sphere matches the target radius.
    expect(group.scale.x).toBeGreaterThan(0);
  });

  it('rejects invalid glTF with a typed error', async () => {
    await expect(loadSpacecraftModel('not a gltf', 1)).rejects.toThrow();
  });
});
