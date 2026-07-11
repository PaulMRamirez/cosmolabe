// A thin helper over propagateCowellEx for the estimators: from a 6-state at epoch t0,
// integrate (with the STM co-integrated) far enough to reach every requested epoch, and
// expose the interpolated state-at-epoch and the STM Phi(t, t0) at any epoch in the arc.
// The estimators call this once per iteration (batch) or per step (EKF), reusing the one
// dense solution for all sample epochs so the integration is paid once. (Vallado §10.2.)

import type { CartesianState } from '@bessel/spice';
import { propagateCowellEx, type ForceModel, type CowellResult } from '@bessel/propagator';
import { OdError } from './errors.ts';

/** A propagated arc: the state-at-epoch sampler and the STM-at-epoch sampler. */
export interface Arc {
  /** Interpolated 6-state [x,y,z,vx,vy,vz] at `et` (must lie within the arc). */
  stateAt(et: number): Float64Array;
  /** Phi(et, t0) row-major length 36. */
  stmAt(et: number): Float64Array;
  readonly result: CowellResult;
}

function toCartesian(state6: ArrayLike<number>): CartesianState {
  return {
    position: { x: state6[0]!, y: state6[1]!, z: state6[2]! },
    velocity: { x: state6[3]!, y: state6[4]!, z: state6[5]! },
  };
}

/**
 * Propagate `state6` from `t0` so the arc spans `[min(epochs), max(epochs)]`. Epochs may
 * lie on either side of t0; the integrator runs forward, so t0 must be the earliest
 * epoch (the batch/EKF callers arrange this). The grid is just the requested epochs (the
 * dense solution interpolates exactly). Returns samplers backed by the single solution.
 */
export function propagateArc(
  state6: ArrayLike<number>,
  t0: number,
  epochs: readonly number[],
  forceModel: ForceModel,
  frame?: string,
): Arc {
  if (epochs.length === 0) throw new OdError('propagateArc needs at least one epoch');
  let tMax = t0;
  for (const e of epochs) {
    if (e < t0 - 1e-6) throw new OdError(`propagateArc: epoch ${e} precedes t0 ${t0}; t0 must be the earliest epoch`);
    if (e > tMax) tMax = e;
  }
  // The grid must extend strictly past the epoch for propagateCowellEx; add a guard step.
  const span = Math.max(tMax - t0, 1e-3);
  const grid = Float64Array.of(t0 + span);
  const result = propagateCowellEx({
    state: toCartesian(state6),
    epoch: t0,
    etGrid: grid,
    forceModel,
    frame: frame ?? 'J2000',
    stm: true,
  });
  if (!result.stmAt) throw new OdError('propagateArc: STM channel missing from propagateCowellEx');
  const stmAt = result.stmAt;
  const scratch = new Float64Array(6);
  return {
    stateAt(et: number): Float64Array {
      result.solution.interpolateInto(et, scratch);
      return scratch.slice(0, 6);
    },
    stmAt(et: number): Float64Array {
      return stmAt(et);
    },
    result,
  };
}
