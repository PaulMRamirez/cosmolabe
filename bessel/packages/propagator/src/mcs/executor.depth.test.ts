// MCS depth oracles beyond the single-level MVP:
//   1. Finite-burn targeting: a Target varies a finite burn's DURATION (a control that falls
//      to the finite-difference Jacobian) to hit a downstream apoapsis-radius goal, then we
//      assert the corrector converged and the achieved apoapsis matches the goal.
//   2. Nested (multi-level) correctors: an OUTER Target varies an initial impulsive burn to
//      reach a downstream radius, while an INNER Target (run to convergence inside each outer
//      residual evaluation) independently nulls a flight-path angle with its own burn. Both
//      converge, and both DcReports surface.
// Each result is checked against an independent computation, not the corrector's own state.
// (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { runMcs } from './executor.ts';
import { createMissionEnv } from './env.ts';
import { rv2coe } from './elements.ts';
import type { Mcs, Segment } from './segments.ts';

const MU = 398600.4418;
const RE = 6378.137;
const env = createMissionEnv(new Map([[399, { gm: MU, bodyRadius: RE }]]), { rtol: 1e-12, atol: 1e-12 });

const vCirc = Math.sqrt(MU / 7000);
const ini = (v: { x: number; y: number; z: number }): Segment => ({
  kind: 'InitialState',
  id: 'ini',
  epoch: 0,
  centralBody: 399,
  mass: 2000,
  frame: 'J2000',
  coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v },
});

describe('finite-burn targeting', () => {
  it('varies a finite-burn duration to reach a downstream apoapsis radius', () => {
    const raGoal = 8500;
    const mcs: Mcs = {
      version: 1,
      root: {
        kind: 'Sequence',
        id: 'root',
        children: [
          ini({ x: 0, y: vCirc, z: 0 }),
          {
            kind: 'Target',
            id: 'tgt',
            corrector: 'DifferentialCorrector',
            controls: [{ segment: 'fb', param: 'Maneuver.duration', perturbation: 0.5, initial: 60, maxStep: 60, scale: 60 }],
            goals: [{ evalAt: 'End', type: 'RadiusOfApoapsis', desired: raGoal, tolerance: 1e-3 }],
            children: [
              // A prograde finite burn (direction in VNB +V); duration is the control.
              { kind: 'Maneuver', id: 'fb', mode: 'Finite', attitude: 'VNB', dv: { x: 1, y: 0, z: 0 }, isp: 320, thrustN: 800, duration: 60 },
              { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 120, stop: [{ type: 'Duration', value: 120 }] },
            ],
          },
        ],
      },
    };
    const run = runMcs(mcs, env);
    const rep = run.targetReports[0]!;
    expect(rep.converged).toBe(true);
    expect(rep.extraRuns).toBeGreaterThan(0); // a duration control => finite-difference column
    // Independent check: recompute apoapsis from the final state's elements.
    const coe = rv2coe(MU, run.final.r, run.final.v);
    expect(coe.raApo).toBeCloseTo(raGoal, 2);
    // Propellant was consumed (mass strictly decreased from the 2000 kg seed).
    expect(run.final.mass).toBeLessThan(2000);
    expect(run.final.mass).toBeGreaterThan(0);
  });
});

describe('nested (multi-level) correctors', () => {
  it('an inner corrector nulls a condition while an outer corrector hits a radius', () => {
    // Outer: vary an initial prograde impulse so the FINAL radius reaches 7300 km.
    // Inner: after a coast, vary a radial burn so the flight-path angle is nulled at its
    // own end. The inner Target runs to convergence inside every outer residual evaluation.
    const mcs: Mcs = {
      version: 1,
      root: {
        kind: 'Sequence',
        id: 'root',
        children: [
          ini({ x: 0, y: vCirc, z: 0 }),
          {
            kind: 'Target',
            id: 'outer',
            corrector: 'DifferentialCorrector',
            controls: [{ segment: 'raise', param: 'Maneuver.dv.x', perturbation: 1e-5, initial: 0.03, maxStep: 0.3 }],
            goals: [{ evalAt: 'End', type: 'Radius', desired: 7300, tolerance: 1e-3 }],
            children: [
              { kind: 'Maneuver', id: 'raise', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.03, y: 0, z: 0 } },
              { kind: 'Propagate', id: 'climb', model: 'TwoBody', maxDuration: 600, stop: [{ type: 'Duration', value: 600 }] },
              {
                kind: 'Target',
                id: 'inner',
                corrector: 'DifferentialCorrector',
                controls: [{ segment: 'trim', param: 'Maneuver.dv.z', perturbation: 1e-6, initial: 0, maxStep: 1 }],
                goals: [{ evalAt: 'End', type: 'FlightPathAngle', desired: 0, tolerance: 1e-10 }],
                children: [
                  { kind: 'Maneuver', id: 'trim', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0, y: 0, z: 0 } },
                  { kind: 'Propagate', id: 'settle', model: 'TwoBody', maxDuration: 1, stop: [{ type: 'Duration', value: 1 }] },
                ],
              },
            ],
          },
        ],
      },
    };
    const run = runMcs(mcs, env);

    // Both reports surface: the outer first, then the inner from the converged replay.
    const outer = run.targetReports.find((r) => r.segmentPath.includes('outer'))!;
    const inner = run.targetReports.find((r) => r.segmentPath.includes('inner'))!;
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(outer.converged).toBe(true);
    expect(inner.converged).toBe(true);

    // Outer goal: final radius is 7300 km (independent magnitude check).
    const f = run.final;
    expect(Math.hypot(f.r.x, f.r.y, f.r.z)).toBeCloseTo(7300, 2);
    // Inner goal: r.v ~ 0 at the end (flight-path angle nulled), the inner-corrector effect.
    const rdotv = f.r.x * f.v.x + f.r.y * f.v.y + f.r.z * f.v.z;
    expect(Math.abs(rdotv)).toBeLessThan(1e-3);
  });
});
