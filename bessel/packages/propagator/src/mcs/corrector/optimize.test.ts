// The optimizer oracle: a redundant-control fuel-minimization problem with a KNOWN closed-form
// fuel-optimal solution. From a circular LEO, raise apoapsis to a target radius. The fuel-optimal
// maneuver is the single tangential (along-velocity) burn of the Hohmann first impulse, whose
// magnitude is the vis-viva delta-v dv* = sqrt(mu (2/r1 - 1/a2)) - sqrt(mu/r1); ANY out-of-plane
// or radial component only wastes fuel. We give the optimizer THREE delta-v controls (the full
// VNB vector, n = 3) against the ONE apoapsis-radius goal (m = 1), so the constraint manifold is
// 2-dimensional and a whole family of feasible burns raises apoapsis. Seeded at a deliberately
// non-optimal feasible burn (tangential PLUS a wasteful normal component), the projected-gradient
// optimizer must collapse onto the pure tangential burn: total |dv| converges to dv* and the
// off-axis components go to zero, all while keeping the apoapsis goal satisfied.

import { describe, expect, it } from 'vitest';
import { runMcs, runSegment } from '../executor.ts';
import { createMissionEnv } from '../env.ts';
import { DEFAULT_DC_SETTINGS, type Mcs, type Segment } from '../segments.ts';
import { bindControls, bindGoals } from './refs.ts';
import { runOptimizer } from './optimize.ts';
import type { DcEvalContext } from './residual.ts';
import type { MissionState } from '../state.ts';

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
const vCirc = Math.sqrt(MU / R1);

describe('optimizer (minimize delta-v)', () => {
  it('drives a redundant 3-control apoapsis raise to the closed-form tangential delta-v', () => {
    const RA_TARGET = 9000;
    const a2 = (R1 + RA_TARGET) / 2;
    const dvStar = Math.sqrt(MU * (2 / R1 - 1 / a2)) - vCirc; // optimal tangential impulse

    const mcs: Mcs = {
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
            objective: { type: 'minimizeDeltaV' },
            // Three delta-v controls (the whole VNB vector) against a single apoapsis goal: the
            // problem is under-determined (n=3 > m=1), so a fuel-optimal solution must be chosen.
            controls: [
              { segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6, initial: 0.25, scale: 1, maxStep: 0.5 },
              { segment: 'burn', param: 'Maneuver.dv.y', perturbation: 1e-6, initial: 0.15, scale: 1, maxStep: 0.5 },
              { segment: 'burn', param: 'Maneuver.dv.z', perturbation: 1e-6, initial: 0.0, scale: 1, maxStep: 0.5 },
            ],
            goals: [{ evalAt: 'End', type: 'RadiusOfApoapsis', desired: RA_TARGET, tolerance: 1e-4 }],
            children: [
              // Seed: a deliberately non-optimal feasible-ish burn (tangential + wasteful normal).
              { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.25, y: 0.15, z: 0 } },
              { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 60, stop: [{ type: 'Duration', value: 60 }] },
            ],
          },
        ],
      },
    };

    const run = runMcs(mcs, env);
    const opt = run.optimizerReports[0]!;
    expect(opt.converged).toBe(true);

    // The optimized burn is the pure tangential impulse: |dv| == dv* and the off-axis (V-normal)
    // components are driven to zero.
    const [dvx, dvy, dvz] = [opt.controls[0]!, opt.controls[1]!, opt.controls[2]!];
    const totalDv = Math.hypot(dvx, dvy, dvz);
    expect(totalDv).toBeCloseTo(dvStar, 4);
    expect(Math.abs(dvy)).toBeLessThan(1e-3);
    expect(Math.abs(dvz)).toBeLessThan(1e-3);
    expect(dvx).toBeCloseTo(dvStar, 4);

    // The optimum is strictly cheaper than the (feasible) starting point.
    expect(opt.cost).toBeLessThan(opt.initialCost);

    // The apoapsis goal is still satisfied at the optimum.
    const r = run.final.r;
    const v = run.final.v;
    const rmag = Math.hypot(r.x, r.y, r.z);
    const vmag = Math.hypot(v.x, v.y, v.z);
    const energy = (vmag * vmag) / 2 - MU / rmag;
    const a = -MU / (2 * energy);
    const hVec = [r.y * v.z - r.z * v.y, r.z * v.x - r.x * v.z, r.x * v.y - r.y * v.x];
    const h = Math.hypot(hVec[0]!, hVec[1]!, hVec[2]!);
    const ecc = Math.sqrt(Math.max(0, 1 - (h * h) / (MU * a)));
    const raApo = a * (1 + ecc);
    expect(raApo).toBeCloseTo(RA_TARGET, 2);
  });

  it('a plain (objective-less) Target still root-finds without invoking the optimizer', () => {
    // Guard the additive path: with no objective, behavior is unchanged and no optimizer report
    // is produced.
    const mcs: Mcs = {
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
            controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-5, initial: 0.02, maxStep: 0.3 }],
            goals: [{ evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4 }],
            children: [
              { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.02, y: 0, z: 0 } },
              { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 1500, stop: [{ type: 'Duration', value: 1500 }] },
            ],
          },
        ],
      },
    };
    const run = runMcs(mcs, env);
    expect(run.optimizerReports).toHaveLength(0);
    expect(run.targetReports[0]!.converged).toBe(true);
  });

  it('a line-search stall reports converged:false (not a false success)', () => {
    // Drive the optimizer with a restore closure that PINS every trial back to the seed: the line
    // search can never find a feasible point with lower cost, so it stalls with the reduced
    // gradient still large (the seed is far from the fuel-optimal burn). The old rule
    // `projNorm <= tol || iter < maxIterations` reported converged:true for this stalled run; the
    // fix must report converged:false and flag the stall, since stationarity was never reached.
    const input: MissionState = {
      epoch: 0,
      r: { x: R1, y: 0, z: 0 },
      v: { x: 0, y: vCirc, z: 0 },
      mass: 1000,
      centralBody: 399,
      segmentPath: ['ini'],
    };
    const children: Segment[] = [
      { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.3, y: 0.2, z: 0 } },
      { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 60, stop: [{ type: 'Duration', value: 60 }] },
    ];
    // Two redundant dv controls against one analytic position goal: a non-trivial null space, so the
    // projected (reduced) cost gradient is generically nonzero away from the optimum.
    const controls = bindControls(children, [
      { segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6, initial: 0.3, scale: 1, maxStep: 0.5 },
      { segment: 'burn', param: 'Maneuver.dv.y', perturbation: 1e-6, initial: 0.2, scale: 1, maxStep: 0.5 },
    ]);
    // A loosely-toleranced position goal: any nearby point is feasible (so the FINAL feasibility
    // check passes for the pinned seed), but the constraint still defines a non-trivial null space
    // for the projection. The fuel cost is what the optimizer wants to reduce.
    const goals = bindGoals([{ evalAt: 'End', type: 'Position.y', desired: 0, tolerance: 1e9 }]);
    const ctx: DcEvalContext = {
      children,
      goals,
      input,
      env,
      mu: MU,
      execOne: (s, state, wantStm) => runSegment(s, state, env, { stm: wantStm }),
    };
    // restore pins every trial to the seed and reports it as feasible (raw within tolerance), so the
    // optimizer treats the seed as its feasible iterate and the line search can never lower the cost.
    const seed = Float64Array.of(0.3, 0.2);
    const restore = () => ({ c: Float64Array.from(seed), raw: Float64Array.of(0), extraRuns: 0 });

    const { report } = runOptimizer(
      { type: 'minimizeDeltaV' },
      controls,
      goals,
      ctx,
      DEFAULT_DC_SETTINGS,
      ['tgt'],
      restore,
    );

    expect(report.stalled).toBe(true);
    expect(report.converged).toBe(false);
    // The reduced gradient is genuinely far above the stationarity threshold (a real fuel-optimal
    // descent direction exists; the pinned restore just blocked the line search from taking it).
    expect(report.projectedGradientNorm).toBeGreaterThan(1e-3);
  });
});
