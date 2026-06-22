// Range-rate access: the observer-to-target range rate (the signed speed at which the
// range is opening, positive, or closing, negative) must lie within [minKmS, maxKmS].
// The range rate is the projection of the relative velocity onto the line-of-sight unit
// vector, computed analytically from a single spkezr state: rangeRate = (r . v) / |r|.
// Each bound becomes a scalar constraint refined by the shared timeline root-finder
// (mirroring facility elevation), and the band is their intersection. No new SPICE
// geometry-finder binding is introduced; everything derives from spkezr.
// (STK_PARITY_SPEC §4.3, ACC range-rate.)

import type { AberrationCorrection, SpiceEngine, StateVector } from '@bessel/spice';
import { findConstraintWindow, windowIntersectAll, type EphemerisTime, type Window } from '@bessel/timeline';

/**
 * A range-rate constraint: the observer-to-target range rate (km/s) must lie within
 * [minKmS, maxKmS]. Either bound is optional; at least one must be given. A negative
 * range rate is an approaching (closing) target, a positive one is a receding (opening)
 * target, and zero is a closest or farthest approach.
 */
export interface RangeRateConstraint {
  readonly kind: 'rangeRate';
  readonly minKmS?: number;
  readonly maxKmS?: number;
}

/** A typed, located error for a malformed range-rate constraint. */
export class RangeRateConstraintError extends Error {
  override readonly name = 'RangeRateConstraintError';
  constructor(message: string) {
    super(`@bessel/access rangeRate: ${message}`);
  }
}

/**
 * Analytic observer-to-target range rate (km/s) from a single state: the projection of
 * the relative velocity onto the line-of-sight unit vector, rangeRate = (r . v) / |r|.
 * Exported so an oracle test can cross-check it against a finite difference of the range.
 */
export function rangeRateFromState(state: StateVector): number {
  const { position: r, velocity: v } = state;
  const range = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  if (range === 0) return 0;
  return (r.x * v.x + r.y * v.y + r.z * v.z) / range;
}

/**
 * Compute the Window over `span` where the observer-to-target range rate lies within the
 * constraint band. Each bound is reduced to a scalar `g(et) >= 0` and refined by the shared
 * root-finder, then the active bounds are intersected. Fails loud if neither bound is given.
 */
export async function computeRangeRateWindow(
  spice: SpiceEngine,
  observer: string,
  target: string,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  abcorr: AberrationCorrection,
  constraint: RangeRateConstraint,
): Promise<Window> {
  const { minKmS, maxKmS } = constraint;
  if (minKmS === undefined && maxKmS === undefined) {
    throw new RangeRateConstraintError('at least one of minKmS or maxKmS must be given');
  }
  if (minKmS !== undefined && maxKmS !== undefined && maxKmS < minKmS) {
    throw new RangeRateConstraintError(
      `band is empty: maxKmS (${maxKmS}) is below minKmS (${minKmS})`,
    );
  }

  const rangeRate = async (et: number): Promise<number> =>
    rangeRateFromState(await spice.spkezr(target, et, 'J2000', abcorr, observer));

  const pieces: Window[] = [];
  if (maxKmS !== undefined) {
    // Access where rangeRate <= maxKmS, i.e. g = maxKmS - rangeRate >= 0.
    pieces.push(await findConstraintWindow(async (et) => maxKmS - (await rangeRate(et)), span, step));
  }
  if (minKmS !== undefined) {
    // Access where rangeRate >= minKmS, i.e. g = rangeRate - minKmS >= 0.
    pieces.push(await findConstraintWindow(async (et) => (await rangeRate(et)) - minKmS, span, step));
  }
  return windowIntersectAll(pieces);
}
