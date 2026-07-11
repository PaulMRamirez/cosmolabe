// The SPICE-driven sensor geometry moved into core: the FOV cone rim is capped and
// nadir-pointed, and the footprint intercepts FOV rays on the target ellipsoid,
// returning J2000 surface points (and [] on a limb crossing). The SPICE calls are
// faked so the geometry is checked without kernels. (STK_PARITY_SPEC §4.7.)

import { describe, it, expect } from 'vitest';
import type { SpiceEngine } from '@bessel/spice';
import { fovConeRim, footprintFromFov, type InstrumentFov, type FootprintContext } from './footprint-spice.ts';

const boresightFov: InstrumentFov = { boresight: [0, 0, 1], bounds: [[0, 0, 1]] };

describe('fovConeRim', () => {
  it('caps the cone length and points it nadir', () => {
    const sc: readonly [number, number, number] = [0, 0, 0];
    const target: readonly [number, number, number] = [1000, 0, 0];
    // Boresight bound reaches the target when the cap exceeds the range.
    const far = fovConeRim(sc, target, boresightFov, 350_000);
    expect(far[0]![0]).toBeCloseTo(1000, 6);
    expect(far[0]![1]).toBeCloseTo(0, 6);
    // With a shorter cap the rim stops at cap distance along the same direction.
    const capped = fovConeRim(sc, target, boresightFov, 500);
    expect(capped[0]![0]).toBeCloseTo(500, 6);
  });
});

// A fake engine returning canned geometry for the footprint intercept.
function fakeSpice(found: boolean): SpiceEngine {
  const partial = {
    spkpos: async () => ({ position: { x: 1000, y: 0, z: 0 }, lightTime: 0 }),
    sincpt: async () => ({
      found,
      point: { x: 60, y: 0, z: 0 },
      trgepc: 0,
      srfvec: { x: 0, y: 0, z: 0 },
    }),
    pxform: async () => [1, 0, 0, 0, 1, 0, 0, 0, 1], // identity
  };
  return partial as unknown as SpiceEngine;
}

const ctx: FootprintContext = { observerId: '-99', targetId: '399', targetFrame: 'IAU_EARTH' };

describe('footprintFromFov', () => {
  it('returns the body-fixed intercept rotated to J2000 (identity here)', async () => {
    const pts = await footprintFromFov(fakeSpice(true), 0, boresightFov, ctx);
    expect(pts).toHaveLength(1);
    expect(pts[0]![0]).toBeCloseTo(60, 6);
  });

  it('returns no points when a ray misses the body (limb crossing)', async () => {
    const pts = await footprintFromFov(fakeSpice(false), 0, boresightFov, ctx);
    expect(pts).toEqual([]);
  });
});
