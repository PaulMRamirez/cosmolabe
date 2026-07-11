// Coverage overlay + colormap unit tests (headless): a small sample grid builds a
// non-empty draped overlay, the colormap maps 0 and 1 to distinct colors, and a
// malformed spec fails loudly. The Mesh path is exercised through buildScene-style
// setters in the three-scene mesh-leak suites; here we test the pure builders.

import { describe, it, expect } from 'vitest';
import {
  buildCoverageOverlayBuffers,
  buildCoverageOverlayMesh,
  CoverageOverlayError,
  type CoverageOverlaySpec,
} from './coverage-overlay.ts';
import { viridis } from './colormap.ts';

// A 2x2 cell grid (lat rows, lon columns) with a ramp of FOM values.
function sampleSpec(): CoverageOverlaySpec {
  return {
    anchorBody: 'Earth',
    bodyRadiusKm: 6378.137,
    latCount: 2,
    lonCount: 2,
    cells: [
      { latRad: -0.2, lonRad: -0.2, fom: 0 },
      { latRad: -0.2, lonRad: 0.2, fom: 0.3 },
      { latRad: 0.2, lonRad: -0.2, fom: 0.7 },
      { latRad: 0.2, lonRad: 0.2, fom: 1 },
    ],
  };
}

describe('buildCoverageOverlayBuffers', () => {
  it('produces a non-empty overlay (two triangles per cell)', () => {
    const buffers = buildCoverageOverlayBuffers(sampleSpec());
    // 4 cells x 6 vertices each = 24 vertices, 72 position floats, 72 color floats.
    expect(buffers.vertexCount).toBe(24);
    expect(buffers.positions.length).toBe(72);
    expect(buffers.colors.length).toBe(72);
    // No NaN positions; the draped points sit on a finite sphere.
    expect(buffers.positions.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('colors the FOM=0 cell and the FOM=1 cell with distinct colors', () => {
    const buffers = buildCoverageOverlayBuffers(sampleSpec());
    // Cell 0 (FOM 0) is the first 6 vertices; cell 3 (FOM 1) is the last 6 vertices.
    const lowColor = [buffers.colors[0], buffers.colors[1], buffers.colors[2]];
    const highStart = 23 * 3;
    const highColor = [buffers.colors[highStart], buffers.colors[highStart + 1], buffers.colors[highStart + 2]];
    expect(lowColor).not.toEqual(highColor);
  });

  it('fails loudly on a wrong cell count', () => {
    const bad = { ...sampleSpec(), latCount: 3 };
    expect(() => buildCoverageOverlayBuffers(bad)).toThrow(CoverageOverlayError);
  });

  it('fails loudly on a non-positive body radius', () => {
    const bad = { ...sampleSpec(), bodyRadiusKm: 0 };
    expect(() => buildCoverageOverlayBuffers(bad)).toThrow(CoverageOverlayError);
  });

  it('builds a vertex-colored Mesh with a non-empty position attribute', () => {
    const mesh = buildCoverageOverlayMesh(sampleSpec());
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(mesh.geometry.getAttribute('color').count).toBe(position.count);
  });

  it('drapes a flattened body on the (a, a, c) ellipsoid so a pole cell sits nearer the center', () => {
    // A single near-pole cell (high latitude). The polar axis maps to the y component (index 1),
    // so a flattened body (polarRadiusKm < bodyRadiusKm) must pull the pole vertex toward y = 0.
    const poleCell: CoverageOverlaySpec = {
      anchorBody: 'Saturn',
      bodyRadiusKm: 60268, // Saturn equatorial
      latCount: 1,
      lonCount: 1,
      cells: [{ latRad: 1.5, lonRad: 0, fom: 1 }],
    };
    const sphere = buildCoverageOverlayBuffers(poleCell);
    const oblate = buildCoverageOverlayBuffers({ ...poleCell, polarRadiusKm: 54364 }); // Saturn polar
    // Maximum |y| (the polar-axis reach) over all vertices; the flattened body reaches less far.
    const maxAbsY = (buf: Float32Array): number => {
      let m = 0;
      for (let i = 1; i < buf.length; i += 3) m = Math.max(m, Math.abs(buf[i]!));
      return m;
    };
    expect(maxAbsY(oblate.positions)).toBeLessThan(maxAbsY(sphere.positions));
    // The flattening ratio carries through (within the lift factor, which cancels in the ratio).
    expect(maxAbsY(oblate.positions) / maxAbsY(sphere.positions)).toBeCloseTo(54364 / 60268, 4);
  });

  it('defaults the polar radius to the equatorial radius (a sphere) when absent', () => {
    const spec = sampleSpec();
    const withDefault = buildCoverageOverlayBuffers(spec);
    const explicitEqual = buildCoverageOverlayBuffers({ ...spec, polarRadiusKm: spec.bodyRadiusKm });
    expect(Array.from(withDefault.positions)).toEqual(Array.from(explicitEqual.positions));
  });

  it('fails loudly on a non-positive polar radius', () => {
    const bad = { ...sampleSpec(), polarRadiusKm: 0 };
    expect(() => buildCoverageOverlayBuffers(bad)).toThrow(CoverageOverlayError);
  });
});

describe('viridis colormap', () => {
  it('maps 0 and 1 to distinct colors', () => {
    const lo = viridis(0);
    const hi = viridis(1);
    expect(lo).not.toEqual(hi);
  });

  it('clamps out-of-range and non-finite inputs to the endpoints', () => {
    expect(viridis(-5)).toEqual(viridis(0));
    expect(viridis(5)).toEqual(viridis(1));
    expect(viridis(Number.NaN)).toEqual(viridis(0));
  });

  it('returns linear RGB components in [0, 1]', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = viridis(t);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
  });
});
