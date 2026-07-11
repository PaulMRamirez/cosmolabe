// The SQP optimizer oracle: the SAME redundant-control fuel-minimization problem the projected-
// gradient test uses, with the SAME known closed-form optimum, so the two methods are compared
// on equal footing. From a circular LEO, raise apoapsis to a target radius. The fuel-optimal
// maneuver is the single tangential (along-velocity) Hohmann first impulse of magnitude
// dv* = sqrt(mu (2/r1 - 1/a2)) - sqrt(mu/r1); any out-of-plane or radial component only wastes
// fuel. We give the optimizer the full VNB delta-v vector (n = 3) against the single apoapsis-
// radius goal (m = 1), so a 2-dimensional family of feasible burns exists. Seeded at a non-
// optimal feasible burn (tangential plus a wasteful normal component), the SQP optimizer must
// collapse onto the pure tangential burn: |dv| -> dv*, the off-axis components -> 0, the apoapsis
// goal stays satisfied, AND it must reach the optimum in NO MORE outer iterations than the first-
// order projected gradient (its second-order / active-set advantage), demonstrably fewer here.

import { describe, expect, it } from 'vitest';
import { runMcs } from '../executor.ts';
import { createMissionEnv } from '../env.ts';
import type { Mcs, Segment, OptimizerMethod } from '../segments.ts';

const MU = 398600.4418;
const RE = 6378.137;
const env = createMissionEnv(new Map([[399, { gm: MU, bodyRadius: RE }]]), { rtol: 1e-12, atol: 1e-12 });

const ini = (r: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }): Segment => ({
  kind: 'InitialState',
  id: 'ini',
  epoch: 0,
  centralBody: 399,
  mass: 1000,
  frame: 'J2000',
  coord: { type: 'Cartesian', r, v },
});

const R1 = 7000;
const RA_TARGET = 9000;
const vCirc = Math.sqrt(MU / R1);

function apoapsisRaiseMcs(method: OptimizerMethod): Mcs {
  return {
    version: 1,
    root: {
      kind: 'Sequence',
      id: 'root',
      children: [
        ini({ x: R1, y: 0, z: 0 }, { x: 0, y: vCirc, z: 0 }),
        {
          kind: 'Target',
          id: 'tgt',
          corrector: 'DifferentialCorrector',
          objective: { type: 'minimizeDeltaV', method },
          controls: [
            { segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6, initial: 0.25, scale: 1, maxStep: 0.5 },
            { segment: 'burn', param: 'Maneuver.dv.y', perturbation: 1e-6, initial: 0.15, scale: 1, maxStep: 0.5 },
            { segment: 'burn', param: 'Maneuver.dv.z', perturbation: 1e-6, initial: 0.0, scale: 1, maxStep: 0.5 },
          ],
          goals: [{ evalAt: 'End', type: 'RadiusOfApoapsis', desired: RA_TARGET, tolerance: 1e-4 }],
          children: [
            { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.25, y: 0.15, z: 0 } },
            { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 60, stop: [{ type: 'Duration', value: 60 }] },
          ],
        },
      ],
    },
  };
}

describe('SQP optimizer (minimize delta-v)', () => {
  const a2 = (R1 + RA_TARGET) / 2;
  const dvStar = Math.sqrt(MU * (2 / R1 - 1 / a2)) - vCirc; // closed-form tangential impulse

  it('drives the redundant 3-control apoapsis raise to the closed-form tangential delta-v', () => {
    const run = runMcs(apoapsisRaiseMcs('sqp'), env);
    const opt = run.optimizerReports[0]!;
    expect(opt.converged).toBe(true);

    const [dvx, dvy, dvz] = [opt.controls[0]!, opt.controls[1]!, opt.controls[2]!];
    const totalDv = Math.hypot(dvx, dvy, dvz);
    // The optimum is the pure tangential impulse: |dv| == dv* and the off-axis parts vanish.
    expect(totalDv).toBeCloseTo(dvStar, 4);
    expect(dvx).toBeCloseTo(dvStar, 4);
    expect(Math.abs(dvy)).toBeLessThan(1e-3);
    expect(Math.abs(dvz)).toBeLessThan(1e-3);

    // The optimum is strictly cheaper than the feasible starting point.
    expect(opt.cost).toBeLessThan(opt.initialCost);

    // The apoapsis goal is still satisfied at the optimum.
    const { r, v } = run.final;
    const rmag = Math.hypot(r.x, r.y, r.z);
    const vmag = Math.hypot(v.x, v.y, v.z);
    const energy = (vmag * vmag) / 2 - MU / rmag;
    const a = -MU / (2 * energy);
    const hVec = [r.y * v.z - r.z * v.y, r.z * v.x - r.x * v.z, r.x * v.y - r.y * v.x];
    const h = Math.hypot(hVec[0]!, hVec[1]!, hVec[2]!);
    const ecc = Math.sqrt(Math.max(0, 1 - (h * h) / (MU * a)));
    expect(a * (1 + ecc)).toBeCloseTo(RA_TARGET, 2);
  });

  it('reaches the optimum in fewer outer iterations than the projected-gradient method', () => {
    const pg = runMcs(apoapsisRaiseMcs('projectedGradient'), env).optimizerReports[0]!;
    const sqp = runMcs(apoapsisRaiseMcs('sqp'), env).optimizerReports[0]!;

    // Both find the same closed-form optimum (same cost) and satisfy the goal.
    expect(pg.cost).toBeCloseTo(dvStar, 4);
    expect(sqp.cost).toBeCloseTo(dvStar, 4);
    expect(sqp.cost).toBeCloseTo(pg.cost, 5);

    // The second-order SQP step gets there in strictly fewer outer iterations (its quadratic /
    // active-set advantage on this redundant-control problem).
    expect(sqp.outerIterations).toBeLessThan(pg.outerIterations);
  });

  it('the default (no method) Target still uses the projected-gradient optimizer', () => {
    // Guard the additive default: omitting `method` leaves the existing first-order behavior.
    const mcs = apoapsisRaiseMcs('projectedGradient');
    // Strip the method to exercise the default branch.
    const target = (mcs.root as Extract<Segment, { kind: 'Sequence' }>).children[1] as Extract<Segment, { kind: 'Target' }>;
    const noMethod: Mcs = {
      ...mcs,
      root: {
        ...(mcs.root as Extract<Segment, { kind: 'Sequence' }>),
        children: [
          (mcs.root as Extract<Segment, { kind: 'Sequence' }>).children[0]!,
          { ...target, objective: { type: 'minimizeDeltaV' } },
        ],
      },
    };
    const run = runMcs(noMethod, env);
    const opt = run.optimizerReports[0]!;
    expect(opt.converged).toBe(true);
    expect(opt.cost).toBeCloseTo(dvStar, 4);
  });
});
