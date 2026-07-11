// Terrain-masked line-of-sight access: the observer can see the target only when the straight
// line between them, in the body-fixed frame, never dips below the terrain surface given by a
// DEM. The observer and target body-fixed positions come from spkpos in `bodyFrame` (relative to
// the body center), and @bessel/terrain's terrainMaskedLos tests the ray against the DEM at each
// epoch. The boolean clear/blocked series is reduced to a Window with the shared scalar finder:
// g(et) = +1 when the LOS is clear, -1 when blocked, so access is where g >= 0 and each crossing
// is bisected to the terrain grazing epoch. (STK_PARITY_SPEC §4.12, ACC terrain-masked LOS.)

import type { AberrationCorrection, SpiceEngine } from '@bessel/spice';
import { findConstraintWindow, type EphemerisTime, type Window } from '@bessel/timeline';
import { terrainMaskedLos, type Dem } from '@bessel/terrain';

import { bodyRadiiKm } from './facility.ts';

/**
 * A terrain-masked line-of-sight constraint: access only when the observer-to-target line clears
 * the terrain of `body`. `bodyFrame` is the body-fixed frame the DEM is defined in; `dem` gives
 * surface height (m) above the reference sphere as a function of body-fixed lon/lat.
 */
export interface TerrainMaskedLosConstraint {
  readonly kind: 'terrainLos';
  /** The masking body (e.g. "MARS"). */
  readonly body: string;
  /** Body-fixed frame of the masking body (e.g. "IAU_MARS"); the DEM's frame. */
  readonly bodyFrame: string;
  /** The digital elevation model: height (m) above the reference sphere at lon/lat. */
  readonly dem: Dem;
  /** Ray samples passed to terrainMaskedLos (default 256). */
  readonly samples?: number;
}

/** A typed, located error for a malformed terrain-masked LOS constraint. */
export class TerrainMaskedLosConstraintError extends Error {
  override readonly name = 'TerrainMaskedLosConstraintError';
  constructor(message: string) {
    super(`@bessel/access terrainLos: ${message}`);
  }
}

/**
 * Compute the Window over `span` where the observer-to-target line of sight is clear of the
 * terrain of `constraint.body`. Both endpoints are sampled in the body-fixed frame; the boolean
 * clear/blocked series is reduced by the shared finder (clear -> +1, blocked -> -1). The body's
 * mean equatorial radius (RADII[0]) sets the reference sphere the DEM heights ride on. Fails loud
 * on a non-positive sample count.
 */
export async function computeTerrainMaskedLosWindow(
  spice: SpiceEngine,
  observer: string,
  target: string,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  abcorr: AberrationCorrection,
  constraint: TerrainMaskedLosConstraint,
): Promise<Window> {
  const { body, bodyFrame, dem, samples } = constraint;
  if (samples !== undefined && (!Number.isInteger(samples) || samples < 2)) {
    throw new TerrainMaskedLosConstraintError(`samples must be an integer >= 2, got ${samples}`);
  }
  // The mean equatorial radius (RADII[0]) sets the DEM reference sphere; bodyRadiiKm owns the
  // bodvrd read and the positive-radius validation shared with the az-el mask and elevation access.
  const { equatorialKm: bodyRadiusKm } = await bodyRadiiKm(spice, body);

  // g(et) = +1 when the LOS is clear, -1 when blocked. Both positions are body-fixed (km),
  // relative to the body center, the frame the DEM uses. The two spkpos reads are independent,
  // so issue them concurrently (one round-trip of latency, not two).
  const g = async (et: number): Promise<number> => {
    const [obsRes, tgtRes] = await Promise.all([
      spice.spkpos(observer, et, bodyFrame, abcorr, body),
      spice.spkpos(target, et, bodyFrame, abcorr, body),
    ]);
    const clear = terrainMaskedLos(obsRes.position, tgtRes.position, dem, bodyRadiusKm, samples);
    return clear ? 1 : -1;
  };
  return findConstraintWindow(g, span, step);
}
