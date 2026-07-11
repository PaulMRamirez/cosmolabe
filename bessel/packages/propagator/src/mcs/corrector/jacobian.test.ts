// The STM-analytic Jacobian column must agree with an independent finite difference of the
// full residual: this isolates a wrong Phi index or a wrong gradient sign before it can
// poison convergence. Plus the mayRetargetStop predicate that routes geometric-stop coasts
// to finite difference. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { runSegment } from '../executor.ts';
import { createMissionEnv } from '../env.ts';
import { bindControls, bindGoals } from './refs.ts';
import { evaluateResidual, type DcEvalContext } from './residual.ts';
import { assembleJacobian, fdStep, mayRetargetStop } from './jacobian.ts';
import { DEFAULT_DC_SETTINGS, type Segment } from '../segments.ts';
import type { MissionState } from '../state.ts';

const MU = 398600.4418;
const env = createMissionEnv(new Map([[399, { gm: MU, bodyRadius: 6378.137 }]]), { rtol: 1e-12, atol: 1e-12 });
const vCirc = Math.sqrt(MU / 7000);

const input: MissionState = {
  epoch: 0,
  r: { x: 7000, y: 0, z: 0 },
  v: { x: 0, y: vCirc, z: 0 },
  mass: 1000,
  centralBody: 399,
  segmentPath: ['ini'],
};

const children: Segment[] = [
  { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.03, y: 0, z: 0 } },
  { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 1500, stop: [{ type: 'Duration', value: 1500 }] },
];

describe('Jacobian STM column vs finite difference', () => {
  it('agrees on d(Radius)/d(dv_x) to better than 1e-4 relative', () => {
    const controls = bindControls(children, [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6 }]);
    const goals = bindGoals([{ evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4 }]);
    const ctx: DcEvalContext = {
      children,
      goals,
      input,
      env,
      mu: MU,
      execOne: (s, state, wantStm) => runSegment(s, state, env, { stm: wantStm }),
    };
    const c = Float64Array.of(0.03);

    const base = evaluateResidual(c, controls, ctx, true);
    const stmJac = assembleJacobian(c, base, controls, goals, ctx, { ...DEFAULT_DC_SETTINGS, useStm: true });
    const fdJac = assembleJacobian(c, base, controls, goals, ctx, { ...DEFAULT_DC_SETTINGS, useStm: false, useCentralDifference: true });

    expect(stmJac.extraRuns).toBe(0);
    expect(fdJac.extraRuns).toBe(2); // central difference: two propagations
    const rel = Math.abs(stmJac.J[0]! - fdJac.J[0]!) / Math.abs(fdJac.J[0]!);
    expect(rel).toBeLessThan(1e-4);
  });

  it('does NOT use the analytic STM for an upstream control across a later burn (falls back to FD)', () => {
    // A multi-segment Target: a control on the FIRST burn's delta-v, with a SECOND burn and coast
    // downstream. The published coast STM is referenced to the post-burn2 coast (stmEpoch != the
    // burn1 injection epoch), so the analytic column would push the burn1 seed through the WRONG
    // STM. The epoch gate must reject the analytic path and finite-difference instead, and the
    // resulting column must match an independent central-difference reference.
    const multi: Segment[] = [
      { kind: 'Maneuver', id: 'burn1', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.03, y: 0, z: 0 } },
      { kind: 'Propagate', id: 'coast1', model: 'TwoBody', maxDuration: 800, stop: [{ type: 'Duration', value: 800 }] },
      { kind: 'Maneuver', id: 'burn2', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.02, y: 0, z: 0 } },
      { kind: 'Propagate', id: 'coast2', model: 'TwoBody', maxDuration: 700, stop: [{ type: 'Duration', value: 700 }] },
    ];
    const controls = bindControls(multi, [{ segment: 'burn1', param: 'Maneuver.dv.x', perturbation: 1e-6 }]);
    const goals = bindGoals([{ evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4 }]);
    const ctx: DcEvalContext = {
      children: multi,
      goals,
      input,
      env,
      mu: MU,
      execOne: (s, state, wantStm) => runSegment(s, state, env, { stm: wantStm }),
    };
    const c = Float64Array.of(0.03);

    const base = evaluateResidual(c, controls, ctx, true);
    // The coast STM is referenced to the post-burn2 epoch, NOT the burn1 injection epoch.
    expect(base.stmEpoch).not.toBeUndefined();
    expect(base.burnStates.get('burn1')!.epoch).toBe(0);
    expect(base.stmEpoch!).toBeGreaterThan(0);

    const stmJac = assembleJacobian(c, base, controls, goals, ctx, { ...DEFAULT_DC_SETTINGS, useStm: true });
    // The analytic path was rejected: a finite-difference column was computed (extraRuns > 0).
    expect(stmJac.extraRuns).toBeGreaterThan(0);

    // And the column it produced matches an independent central-difference reference within tol.
    const fdJac = assembleJacobian(c, base, controls, goals, ctx, {
      ...DEFAULT_DC_SETTINGS,
      useStm: false,
      useCentralDifference: true,
    });
    const rel = Math.abs(stmJac.J[0]! - fdJac.J[0]!) / Math.abs(fdJac.J[0]!);
    expect(rel).toBeLessThan(1e-4);
  });
});

describe('Radius/Altitude gradient rmag floor', () => {
  const at0 = (r: { x: number; y: number; z: number }): MissionState => ({
    epoch: 0,
    r,
    v: { x: 0, y: 7.5, z: 0 },
    mass: 1000,
    centralBody: 399,
    segmentPath: ['ini'],
  });

  it('returns a finite analytic gradient away from the origin', () => {
    const goal = bindGoals([{ evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4 }])[0]!;
    const g = goal.gradWrtState(at0({ x: 7000, y: 0, z: 0 }), MU);
    expect(g).not.toBeNull();
    expect(g!.every((x) => Number.isFinite(x))).toBe(true);
  });

  it('returns null below the rmag floor so a NaN unit vector cannot pass and poison the STM', () => {
    const goal = bindGoals([{ evalAt: 'End', type: 'Radius', desired: 0, tolerance: 1e-4 }])[0]!;
    // r ~ 0: r/|r| is numerically NaN; the analytic path must decline (null) and force FD.
    expect(goal.gradWrtState(at0({ x: 0, y: 0, z: 0 }), MU)).toBeNull();
    expect(goal.gradWrtState(at0({ x: 1e-12, y: 0, z: 0 }), MU)).toBeNull();
  });
});

describe('finite-difference step sizing', () => {
  it('scales the step by the control magnitude, not by ctrl.scale', () => {
    // A genuine ~1e-9 trim control with the default 1e-6 relative size: the step must follow the
    // control's own tiny magnitude (and its explicit perturbation floor), never a scale of 1 which
    // would give a ~1e-6 step that strides across a nonlinear region.
    const rel = 1e-6;
    const tiny = 1e-9;
    const perturbation = 1e-12;
    const step = fdStep(rel, tiny, perturbation);
    // Old behavior (scale=1) would have been rel*1 = 1e-6; the fixed step is far smaller.
    expect(step).toBeLessThan(1e-6);
    expect(step).toBe(Math.max(rel * Math.max(tiny, perturbation), perturbation));
    // The explicit perturbation still floors a zero-valued control.
    expect(fdStep(rel, 0, perturbation)).toBe(perturbation);
  });
});

describe('mayRetargetStop', () => {
  const ctrl = bindControls(children, [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6 }])[0]!;

  it('is false for a fixed-duration coast', () => {
    expect(mayRetargetStop(children, ctrl)).toBe(false);
  });

  it('is true for a coast with a geometric stop', () => {
    const geo: Segment[] = [
      children[0]!,
      { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 6000, stop: [{ type: 'Apoapsis' }] },
    ];
    expect(mayRetargetStop(geo, ctrl)).toBe(true);
  });
});
