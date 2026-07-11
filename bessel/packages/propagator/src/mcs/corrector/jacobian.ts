// Assemble the corrector Jacobian d(scaled residual)/d(nondim control). A column is built
// analytically from the coast STM when the control is STM-served (a delta-v or initial
// r/v), every goal supplies a closed-form dg/dx, and no geometric stop can shift the
// evaluation epoch (mayRetargetStop) - then it costs ZERO extra propagations. Otherwise the
// column is finite-differenced by re-running the residual. (STK_PARITY_SPEC §4.3.)

import type { DcSettings, PropagateSegment, Segment, StopCondition } from '../segments.ts';
import type { MissionState } from '../state.ts';
import type { ControlBinding, GoalBinding } from './refs.ts';
import { evaluateResidual, type DcEvalContext, type ResidualEval } from './residual.ts';
import { vnbAxisToInertial } from '../frames.ts';

export interface JacobianResult {
  /** Row-major m x n Jacobian in scaled/nondimensional units. */
  readonly J: Float64Array;
  readonly rows: number;
  readonly cols: number;
  /** Extra residual propagations spent on finite-difference columns. */
  readonly extraRuns: number;
}

/** True if a control could move which event ends a geometric-stop coast (so the STM, which
 * holds the evaluation epoch fixed, would miss the stop-time sensitivity: fall back to FD). */
export function mayRetargetStop(children: readonly Segment[], _control: ControlBinding): boolean {
  const geometric = (s: StopCondition): boolean => s.type !== 'Duration' && s.type !== 'Epoch';
  const scan = (segs: readonly Segment[]): boolean =>
    segs.some((seg) => {
      if (seg.kind === 'Propagate') return (seg as PropagateSegment).stop.some(geometric);
      if (seg.kind === 'Sequence' || seg.kind === 'Target') return scan(seg.children);
      return false;
    });
  return scan(children);
}

/** Tolerance (s) for matching the coast STM's reference epoch to a control's injection epoch. */
const STM_EPOCH_TOL = 1e-6;

/**
 * The epoch at which a control injects its seed perturbation: a delta-v control injects at its
 * maneuver's epoch (the pre-burn state captured in `burnStates`), an initial-state r/v control at
 * the arc input epoch. Returns undefined when the epoch cannot be resolved (then the analytic STM
 * path is not safe and the caller falls back to finite difference).
 */
function injectionEpochOf(base: ResidualEval, ctrl: ControlBinding, input: MissionState): number | undefined {
  const a = ctrl.seedAxis;
  if (!a) return undefined;
  if (a.kind === 'dv') return base.burnStates.get(a.segment)?.epoch;
  return input.epoch; // initial-state r/v: referenced to the arc start
}

/**
 * The base coast STM is referenced to ONE epoch (`base.stmEpoch`). The analytic column propagates a
 * control's seed through it as Phi(eval, stmEpoch) * seed, which is only correct when the STM starts
 * exactly at the control's INJECTION epoch and nothing (a Maneuver or a nested Target) lies between
 * the injection and the STM start to break the linear map. A multi-segment Target whose control sits
 * upstream of a later burn leaves stmEpoch at the post-burn coast, so the seed would be pushed
 * through the wrong STM. Gate on (a) stmEpoch present and matching the injection epoch within
 * tolerance, and (b) no Maneuver/Target segment between the injection and the STM start; otherwise
 * the caller finite-differences (and `extraRuns` reflects it).
 */
function stmServesInjection(base: ResidualEval, ctrl: ControlBinding, input: MissionState): boolean {
  if (base.stmEpoch === undefined) return false;
  const inj = injectionEpochOf(base, ctrl, input);
  if (inj === undefined) return false;
  if (Math.abs(base.stmEpoch - inj) > STM_EPOCH_TOL) return false;
  // Structural guard: even if the epochs coincide numerically, reject if a Maneuver or Target
  // segment whose effect falls in (injection, stmEpoch] would have shifted the linear map.
  return !hasManeuverOrTargetBetween(base, inj, base.stmEpoch);
}

/** True if any evaluated Maneuver/Target segment ends in the open-closed interval (lo, hi]. */
function hasManeuverOrTargetBetween(base: ResidualEval, lo: number, hi: number): boolean {
  if (hi <= lo + STM_EPOCH_TOL) return false; // empty interval: nothing can lie strictly between
  for (const [, st] of base.evalStates) {
    const e = st.epoch;
    if (e > lo + STM_EPOCH_TOL && e <= hi + STM_EPOCH_TOL) return true;
  }
  return false;
}

/**
 * Finite-difference perturbation for control value `c` (relative size `rel`, explicit floor
 * `perturbation`). The relative step is scaled by the control's OWN magnitude, floored by its
 * explicit perturbation, NOT by ctrl.scale: scale is a nondimensionalization reference (default 1),
 * and pinning the relative step to it gives a genuine ~1e-9 trim control a ~1e-6 absolute step that
 * strides across a nonlinear region and smears the derivative. scale is used only to
 * nondimensionalize the assembled column (dNondim), never to size the perturbation.
 */
export function fdStep(rel: number, c: number, perturbation: number): number {
  return Math.max(rel * Math.max(Math.abs(c), perturbation), perturbation);
}

/** Multiply a row-major 6x6 STM by a 6-vector seed. */
function phiTimes(phi: Float64Array, seed: Float64Array): Float64Array {
  const out = new Float64Array(6);
  for (let row = 0; row < 6; row++) {
    let s = 0;
    for (let col = 0; col < 6; col++) s += phi[row * 6 + col]! * seed[col]!;
    out[row] = s;
  }
  return out;
}

export function assembleJacobian(
  c: Float64Array,
  base: ResidualEval,
  controls: readonly ControlBinding[],
  goals: readonly GoalBinding[],
  ctx: DcEvalContext,
  settings: DcSettings,
): JacobianResult {
  const m = goals.length;
  const n = controls.length;
  const J = new Float64Array(m * n);
  let extraRuns = 0;

  const allGoalsAnalytic = goals.every((g, i) => g.gradWrtState(stateFor(base, g), ctx.mu) !== null && hasEval(base, g, i));
  const retarget = (cb: ControlBinding): boolean => mayRetargetStop(ctx.children, cb);

  for (let j = 0; j < n; j++) {
    const ctrl = controls[j]!;
    // The coast STM is referenced to base.stmEpoch; the analytic column is only valid when that
    // epoch is the control's injection epoch with no burn/Target shifting the map in between. A
    // multi-segment Target with an upstream control across a later burn fails this and must FD.
    const stmOk =
      settings.useStm &&
      ctrl.stmServed &&
      !!base.stmAt &&
      !retarget(ctrl) &&
      allGoalsAnalytic &&
      !!ctrl.seedAxis &&
      stmServesInjection(base, ctrl, ctx.input);

    if (stmOk) {
      const seed = seedVector(base, ctrl);
      for (let i = 0; i < m; i++) {
        const goal = goals[i]!;
        const at = stateFor(base, goal);
        const phi = base.stmAt!(at.epoch);
        const dxEval = phiTimes(phi, seed);
        const grad = goal.gradWrtState(at, ctx.mu)!;
        let draw = 0;
        for (let k = 0; k < 6; k++) draw += grad[k]! * dxEval[k]!;
        J[i * n + j] = (draw * goal.weight * ctrl.scale) / goal.tolerance;
      }
      continue;
    }

    // Finite difference (forward, or central when configured).
    const step = fdStep(settings.perturbationRel, c[j]!, ctrl.perturbation);
    const cPlus = Float64Array.from(c);
    cPlus[j] = c[j]! + step;
    const evPlus = evaluateResidual(cPlus, controls, ctx, false);
    extraRuns += 1;
    let evMinusScaled: Float64Array | null = null;
    if (settings.useCentralDifference) {
      const cMinus = Float64Array.from(c);
      cMinus[j] = c[j]! - step;
      evMinusScaled = evaluateResidual(cMinus, controls, ctx, false).residualScaled;
      extraRuns += 1;
    }
    const dNondim = step / ctrl.scale;
    for (let i = 0; i < m; i++) {
      J[i * n + j] = evMinusScaled
        ? (evPlus.residualScaled[i]! - evMinusScaled[i]!) / (2 * dNondim)
        : (evPlus.residualScaled[i]! - base.residualScaled[i]!) / dNondim;
    }
  }

  return { J, rows: m, cols: n, extraRuns };
}

/** The eval state for a goal (falls back to the End state). */
function stateFor(base: ResidualEval, goal: GoalBinding) {
  return base.evalStates.get(goal.evalAt) ?? base.evalStates.get('End')!;
}

function hasEval(base: ResidualEval, goal: GoalBinding, _i: number): boolean {
  return base.evalStates.has(goal.evalAt) || base.evalStates.has('End');
}

/** The 6-vector perturbation a unit of the control injects at the arc-start epoch. */
function seedVector(base: ResidualEval, ctrl: ControlBinding): Float64Array {
  const a = ctrl.seedAxis!;
  if (a.kind === 'dv') {
    const burn = base.burnStates.get(a.segment);
    const dir = burn ? vnbAxisToInertial(a.attitude, a.axis, burn.r, burn.v) : { x: a.axis === 'x' ? 1 : 0, y: a.axis === 'y' ? 1 : 0, z: a.axis === 'z' ? 1 : 0 };
    return Float64Array.of(0, 0, 0, dir.x, dir.y, dir.z);
  }
  const idx = (a.kind === 'r' ? 0 : 3) + (a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2);
  const seed = new Float64Array(6);
  seed[idx] = 1;
  return seed;
}
