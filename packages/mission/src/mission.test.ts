// Lambert validated against Vallado's published example (7-5), and maneuver frames
// against hand-derived bases. Pure, no SPICE. (STK_PARITY_SPEC §4.2.)

import { describe, it, expect } from 'vitest';
import { lambert, frameBasis, applyImpulsiveManeuver, deltaVMagnitude } from './index.ts';

const MU_EARTH = 398600.4418;

describe('lambert', () => {
  it('reproduces Vallado example 7-5 velocities', () => {
    // r1, r2 (km), tof = 76 min; expected v1, v2 (km/s).
    const r1 = { x: 15945.34, y: 0, z: 0 };
    const r2 = { x: 12214.83899, y: 10249.46731, z: 0 };
    const { v1, v2 } = lambert(r1, r2, 76 * 60, MU_EARTH, true);
    expect(v1.x).toBeCloseTo(2.058913, 3);
    expect(v1.y).toBeCloseTo(2.915965, 3);
    expect(v2.x).toBeCloseTo(-3.451565, 3);
    expect(v2.y).toBeCloseTo(0.910315, 3);
  });

  it('produces a transfer whose endpoints reach r2 (energy/closure sanity)', () => {
    const r1 = { x: 5000, y: 10000, z: 2100 };
    const r2 = { x: -14600, y: 2500, z: 7000 };
    const sol = lambert(r1, r2, 3600, MU_EARTH, true);
    // Both velocity solutions are finite and of plausible LEO magnitude.
    expect(deltaVMagnitude(sol.v1)).toBeGreaterThan(1);
    expect(deltaVMagnitude(sol.v1)).toBeLessThan(15);
  });

  it('distinguishes short-way vs long-way for a POLAR transfer via the orbit normal', () => {
    // A transfer in a meridian plane (the orbit plane contains the z-axis): r1 along +x, r2 along
    // +z. Here (r1 x r2).z == 0, so keying the transfer direction off world +Z collapses both
    // mirror solutions to the same long-way branch. The orbit normal is along the y-axis; the two
    // signs of that normal pick the short way vs the long way.
    const r1 = { x: 7000, y: 0, z: 0 };
    const r2 = { x: 0, y: 0, z: 7000 };
    const tof = 1800; // 30 min, a sub-orbit transfer where short and long way clearly differ
    const nMinus = { x: 0, y: -1, z: 0 };
    const nPlus = { x: 0, y: 1, z: 0 };

    // The orbit plane is the x-z plane: r1 x r2 = (0, -7000^2, 0), i.e. along -y. Against -y the
    // projection is positive (short way, tm=+1); against +y it is negative (long way, tm=-1).
    const shortWay = lambert(r1, r2, tof, MU_EARTH, true, nMinus);
    const longWay = lambert(r1, r2, tof, MU_EARTH, true, nPlus);

    // Both solutions stay in the meridian (x-z) plane: no y-velocity for a planar transfer.
    expect(shortWay.v1.y).toBeCloseTo(0, 6);
    expect(longWay.v1.y).toBeCloseTo(0, 6);
    // The two branches are genuinely different (the bug collapsed them to one). The short-way
    // initial velocity carries the spacecraft toward +z (the 90 deg sweep), the long way away.
    expect(shortWay.v1.z).toBeGreaterThan(0);
    expect(longWay.v1.z).toBeLessThan(0);
    expect(Math.abs(shortWay.v1.z - longWay.v1.z)).toBeGreaterThan(0.5);

    // The branch is driven jointly by the prograde flag and the orbit normal: flipping BOTH (a
    // prograde transfer about +normal vs a retrograde transfer about -normal) selects the same
    // physical sweep direction, so the velocities coincide. The world-Z fallback cannot express
    // this for a meridian-plane transfer because its angular momentum projects onto +Z as zero.
    const progradePlus = lambert(r1, r2, tof, MU_EARTH, true, nPlus);
    const retroMinus = lambert(r1, r2, tof, MU_EARTH, false, nMinus);
    expect(retroMinus.v1.z).toBeCloseTo(progradePlus.v1.z, 9);
  });
});

describe('maneuver frames', () => {
  // A circular equatorial orbit: r along +x, v along +y.
  const state = { position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 7.5, z: 0 } };

  it('RIC basis is radial/in-track/cross-track and orthonormal', () => {
    const b = frameBasis(state, 'RIC');
    expect(b.x).toEqual({ x: 1, y: 0, z: 0 }); // radial
    expect(b.y.y).toBeCloseTo(1, 9); // in-track ~ +y
    expect(b.z.z).toBeCloseTo(1, 9); // cross-track ~ +z
  });

  it('a prograde VNB burn adds along the velocity direction', () => {
    const after = applyImpulsiveManeuver(state, { x: 0.1, y: 0, z: 0 }, 'VNB');
    expect(after.velocity.y).toBeCloseTo(7.6, 9); // +0.1 km/s prograde
    expect(after.velocity.x).toBeCloseTo(0, 9);
    expect(after.position).toEqual(state.position); // impulsive: position unchanged
  });

  it('a radial RIC burn adds along the radial direction', () => {
    const after = applyImpulsiveManeuver(state, { x: 0.2, y: 0, z: 0 }, 'RIC');
    expect(after.velocity.x).toBeCloseTo(0.2, 9);
    expect(after.velocity.y).toBeCloseTo(7.5, 9);
  });
});
