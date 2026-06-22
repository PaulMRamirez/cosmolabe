// Sun-exclusion (sensor keep-out) access: the observer-to-Sun angular separation must stay
// at or above a keep-out half-angle, so a bright body never lands inside the sensor's
// exclusion cone. This reduces to the native angular-separation finder (gfsep) with the
// relation ">": the access window is the set of epochs where sep(observer->Sun, observer->target)
// exceeds the keep-out. The separation gfsep reports is measured at the observer between the
// two target directions, which is exactly the angle the keep-out cone is built around.
// (STK_PARITY_SPEC §4.3, ACC sun-exclusion.)

import type { AberrationCorrection, SpiceEngine } from '@bessel/spice';
import type { EphemerisTime, Window } from '@bessel/timeline';

/**
 * A Sun-exclusion (keep-out) constraint: the angular separation between the observer-to-Sun
 * direction and the observer-to-target direction must be at least `keepoutRad`. Used to keep a
 * sensor's boresight clear of the Sun (or any bright `sunTarget`). `keepoutRad` is the half-angle
 * of the exclusion cone in radians and must be positive.
 */
export interface SunExclusionConstraint {
  readonly kind: 'sunExclusion';
  /** Keep-out half-angle (rad); must be > 0. */
  readonly keepoutRad: number;
  /** The bright body to exclude; defaults to "SUN". */
  readonly sunTarget?: string;
}

/** A typed, located error for a malformed Sun-exclusion constraint. */
export class SunExclusionConstraintError extends Error {
  override readonly name = 'SunExclusionConstraintError';
  constructor(message: string) {
    super(`@bessel/access sunExclusion: ${message}`);
  }
}

/**
 * Compute the Window over `span` where the observer-to-Sun (or `sunTarget`) separation from the
 * observer-to-target direction is at or above `keepoutRad`. Uses gfsep with relate ">"; both
 * bodies are treated as POINT shapes (the keep-out is about boresight pointing, not limbs).
 * Fails loud if the keep-out is not positive.
 */
export async function computeSunExclusionWindow(
  spice: SpiceEngine,
  observer: string,
  target: string,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  abcorr: AberrationCorrection,
  constraint: SunExclusionConstraint,
): Promise<Window> {
  const { keepoutRad } = constraint;
  if (!(keepoutRad > 0)) {
    throw new SunExclusionConstraintError(`keepoutRad must be > 0, got ${keepoutRad}`);
  }
  const sun = constraint.sunTarget ?? 'SUN';
  const [t0, t1] = span;
  // Access where sep(observer->sun, observer->target) >= keepoutRad. POINT shapes make the
  // separation the angle between the two direction vectors at the observer; the frame arguments
  // are unused for POINT shapes but a valid frame must still be passed.
  return spice.gfsep(
    sun,
    'POINT',
    'J2000',
    target,
    'POINT',
    'J2000',
    abcorr,
    observer,
    '>',
    keepoutRad,
    0,
    step,
    t0,
    t1,
  );
}
