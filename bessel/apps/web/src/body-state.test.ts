// B20: the State panel's compute helper assembles a Cartesian state (spkezr) and the
// classical elements (via @bessel/propagator rv2coe) into a BodyState. Deterministic
// mock SPICE returning known states; the element values are checked against closed
// forms, and degenerate orbits fall to null (n/a).

import { describe, it, expect } from 'vitest';
import type { SpiceEngine, Vec3 } from '@bessel/spice';
import { computeBodyState } from './body-state.ts';

const EARTH_MU = 398600.4418;

// A mock SPICE whose spkezr returns a caller-supplied state (or throws).
function mockSpice(opts: { readonly r?: Vec3; readonly v?: Vec3; readonly throwOn?: 'spkezr' }): SpiceEngine {
  const engine = {
    spkezr: async () => {
      if (opts.throwOn === 'spkezr') throw new Error('no ephemeris');
      return {
        position: opts.r ?? { x: 7000, y: 0, z: 0 },
        velocity: opts.v ?? { x: 0, y: 7.5461, z: 0 },
        lightTime: 0,
      };
    },
  };
  return engine as unknown as SpiceEngine;
}

describe('computeBodyState', () => {
  it('passes through r/v and derives a circular orbit (e~0, a=radius, i=0)', async () => {
    // Circular equatorial: v = sqrt(mu/r) keeps eccentricity ~0.
    const s = await computeBodyState(mockSpice({}), 'Probe', 'Earth', 'J2000', 0, EARTH_MU);
    expect(s).not.toBeNull();
    expect(s!.r).toEqual([7000, 0, 0]);
    expect(s!.v).toEqual([0, 7.5461, 0]);
    expect(s!.semiMajorKm).toBeCloseTo(7000, 0);
    expect(s!.ecc).toBeLessThan(1e-3);
    expect(s!.incDeg).toBeCloseTo(0, 4);
  });

  it('derives an inclined elliptical orbit with finite, bounded elements', async () => {
    const s = await computeBodyState(
      mockSpice({ r: { x: 8000, y: 1000, z: 2000 }, v: { x: -1, y: 7, z: 1 } }),
      'Probe',
      'Earth',
      'J2000',
      0,
      EARTH_MU,
    );
    expect(s).not.toBeNull();
    expect(s!.ecc).toBeGreaterThan(0);
    expect(s!.ecc).toBeLessThan(1);
    expect(s!.semiMajorKm).toBeGreaterThan(0);
    expect(s!.incDeg).toBeGreaterThan(0);
    expect(Number.isFinite(s!.trueAnomalyDeg)).toBe(true);
    expect(s!.trueAnomalyDeg).toBeGreaterThanOrEqual(0);
    expect(s!.trueAnomalyDeg).toBeLessThan(360);
  });

  it('is finite and safe for a hyperbolic orbit (e > 1, negative semi-major axis)', async () => {
    // Speed well above escape (sqrt(2*mu/r) ~ 10.67 km/s here) gives a hyperbola.
    const s = await computeBodyState(
      mockSpice({ r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: 15, z: 0 } }),
      'Flyby',
      'Jupiter',
      'J2000',
      0,
      EARTH_MU,
    );
    expect(s).not.toBeNull();
    expect(s!.ecc).toBeGreaterThan(1);
    expect(s!.semiMajorKm).toBeLessThan(0);
    expect(Number.isFinite(s!.trueAnomalyDeg)).toBe(true);
  });

  it('returns null when the body is its own center', async () => {
    expect(await computeBodyState(mockSpice({}), 'Saturn', 'Saturn', 'J2000', 0, EARTH_MU)).toBeNull();
  });

  it('returns null (n/a) when spkezr rejects', async () => {
    expect(await computeBodyState(mockSpice({ throwOn: 'spkezr' }), 'A', 'B', 'J2000', 0, EARTH_MU)).toBeNull();
  });

  it('returns null (n/a) for a degenerate orbit rather than a fabricated element set', async () => {
    // Zero velocity is rectilinear: rv2coe rejects it loudly, so the panel shows n/a.
    const s = await computeBodyState(
      mockSpice({ r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 } }),
      'A',
      'B',
      'J2000',
      0,
      EARTH_MU,
    );
    expect(s).toBeNull();
  });
});
