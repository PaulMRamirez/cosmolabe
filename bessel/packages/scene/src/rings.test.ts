// Item 2 (texture fidelity): ring UVs must match Cosmographia/VESTA's 1-D radial
// strip (inner UV (0,0), outer UV (1,0), no per-section V variation) and the
// procedural fallback must be a horizontal width=N, height=1 strip with a real
// alpha gap (the Cassini Division). Pure builders, tested headlessly.

import { describe, it, expect } from 'vitest';
import { ClampToEdgeWrapping } from 'three';
import { buildRingVertices, bandedRingTexture } from './rings.ts';

describe('buildRingVertices', () => {
  it('emits inner UV (0,0) and outer UV (1,0) for every section (v=0 strip)', () => {
    const segments = 24;
    const v = buildRingVertices(74500, 140220, segments);
    expect(v.uvs.length).toBe((segments + 1) * 4);
    for (let i = 0; i < v.uvs.length; i += 4) {
      // inner-edge vertex
      expect(v.uvs[i]).toBe(0);
      expect(v.uvs[i + 1]).toBe(0);
      // outer-edge vertex
      expect(v.uvs[i + 2]).toBe(1);
      expect(v.uvs[i + 3]).toBe(0);
    }
  });

  it('does not vary V around the ring (no per-section V)', () => {
    const v = buildRingVertices(1, 2, 8);
    const everyVZero = Array.from(v.uvs).filter((_, idx) => idx % 2 === 1).every((u) => u === 0);
    expect(everyVZero).toBe(true);
  });
});

describe('bandedRingTexture', () => {
  it('returns a width=N, height=1 strip clamped on both axes', () => {
    const tex = bandedRingTexture([0.86, 0.8, 0.66]);
    expect(tex.image.height).toBe(1);
    expect(tex.image.width).toBeGreaterThan(1);
    expect(tex.wrapS).toBe(ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(ClampToEdgeWrapping);
  });

  it('carves an alpha gap (the Cassini Division) somewhere along the radius', () => {
    const tex = bandedRingTexture([0.86, 0.8, 0.66]);
    const data = tex.image.data as Uint8Array;
    let zeroAlpha = 0;
    for (let x = 0; x < tex.image.width; x++) {
      if (data[x * 4 + 3] === 0) zeroAlpha += 1;
    }
    expect(zeroAlpha).toBeGreaterThan(0);
  });
});
