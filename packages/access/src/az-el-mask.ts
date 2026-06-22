// Azimuth-elevation mask access: a ground facility sees the target only when the target's
// topocentric elevation clears a (possibly azimuth-dependent) horizon mask. Two regimes:
//   - a single constant `minElevationRad` floor reduces to the native coordinate finder
//     (gfposc) on the observer-to-target vector, taking the LATITUDINAL LATITUDE coordinate in
//     the facility's body-fixed frame as the elevation;
//   - an azimuth-indexed `mask` table (a polygonal skyline) has no single refval, so it is
//     reduced to the shared scalar finder with g(et) = elevation(et) - floor(azimuth(et)), the
//     floor linearly interpolated around the azimuth circle.
// Azimuth here is measured in the body-fixed frame from +X toward +Y (the LATITUDINAL longitude
// of the observer-to-target vector); both the table and the sampled azimuth use that same
// convention, so only their difference matters. (STK_PARITY_SPEC §4.3, ACC az-el mask.)

import type { AberrationCorrection, SpiceEngine, Vec3 } from '@bessel/spice';
import { findConstraintWindow, type EphemerisTime, type Window } from '@bessel/timeline';
import type { Facility } from './facility.ts';

/** One vertex of an azimuth-indexed elevation mask: a minimum elevation at an azimuth. */
export interface MaskPoint {
  /** Azimuth (rad), the LATITUDINAL longitude of the observer-to-target vector, in [-pi, pi]. */
  readonly azimuthRad: number;
  /** Minimum acceptable elevation (rad) at this azimuth. */
  readonly minElevationRad: number;
}

/**
 * An azimuth-elevation mask constraint at a ground facility: the target must be at or above the
 * horizon mask. Provide exactly one of `minElevationRad` (a constant floor at every azimuth) or
 * `mask` (an azimuth-indexed table interpolated around the circle). Elevation and azimuth are the
 * LATITUDINAL latitude and longitude of the observer-to-target vector in `facility.bodyFrame`.
 */
export interface AzElMaskConstraint {
  readonly kind: 'azElMask';
  readonly facility: Facility;
  /** A constant minimum elevation (rad) at all azimuths. Mutually exclusive with `mask`. */
  readonly minElevationRad?: number;
  /** An azimuth-indexed elevation floor. Mutually exclusive with `minElevationRad`. */
  readonly mask?: readonly MaskPoint[];
}

/** A typed, located error for a malformed azimuth-elevation mask constraint. */
export class AzElMaskConstraintError extends Error {
  override readonly name = 'AzElMaskConstraintError';
  constructor(message: string) {
    super(`@bessel/access azElMask: ${message}`);
  }
}

/**
 * Linearly interpolate the mask floor (rad) at an azimuth (rad), treating the table as a closed
 * loop around the [-pi, pi] azimuth circle. The table is assumed sorted ascending by azimuth.
 */
export function interpolateMaskFloor(mask: readonly MaskPoint[], azimuthRad: number): number {
  const n = mask.length;
  if (n === 1) return mask[0]!.minElevationRad;
  const TWO_PI = 2 * Math.PI;
  // Normalise the query azimuth into the table's first vertex range so wrap is well defined.
  let az = azimuthRad;
  while (az < mask[0]!.azimuthRad) az += TWO_PI;
  while (az >= mask[0]!.azimuthRad + TWO_PI) az -= TWO_PI;
  for (let i = 0; i < n; i++) {
    const a = mask[i]!;
    const next = mask[(i + 1) % n]!;
    const aAz = a.azimuthRad;
    const bAz = i === n - 1 ? next.azimuthRad + TWO_PI : next.azimuthRad; // close the loop
    if (az >= aAz && az <= bAz) {
      const segment = bAz - aAz;
      const frac = segment === 0 ? 0 : (az - aAz) / segment;
      return a.minElevationRad + frac * (next.minElevationRad - a.minElevationRad);
    }
  }
  return mask[n - 1]!.minElevationRad; // unreachable given the wrap normalisation
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Compute the Window over `span` where the target clears the facility's azimuth-elevation mask.
 * A constant floor uses gfposc (LATITUDINAL LATITUDE) directly; a mask table uses the shared
 * scalar finder against the interpolated floor. Fails loud on an empty or ill-formed mask, or if
 * neither / both of `minElevationRad` and `mask` are given.
 */
export async function computeAzElMaskWindow(
  spice: SpiceEngine,
  target: string,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  abcorr: AberrationCorrection,
  constraint: AzElMaskConstraint,
): Promise<Window> {
  const { facility, minElevationRad, mask } = constraint;
  const haveConst = minElevationRad !== undefined;
  const haveMask = mask !== undefined;
  if (haveConst === haveMask) {
    throw new AzElMaskConstraintError('exactly one of minElevationRad or mask must be given');
  }
  const [t0, t1] = span;

  if (haveConst) {
    if (!Number.isFinite(minElevationRad)) {
      throw new AzElMaskConstraintError(`minElevationRad must be finite, got ${minElevationRad}`);
    }
    // Native coordinate finder: elevation is the LATITUDINAL LATITUDE (rad) of the
    // observer-to-target vector in the facility's body-fixed frame. Access where it is >= floor.
    return spice.gfposc(
      target,
      facility.bodyFrame,
      abcorr,
      facility.body,
      'LATITUDINAL',
      'LATITUDE',
      '>',
      minElevationRad as number,
      0,
      step,
      t0,
      t1,
    );
  }

  const table = mask as readonly MaskPoint[];
  if (table.length === 0) {
    throw new AzElMaskConstraintError('mask must contain at least one point');
  }
  for (const p of table) {
    if (!Number.isFinite(p.azimuthRad) || !Number.isFinite(p.minElevationRad)) {
      throw new AzElMaskConstraintError('mask points must have finite azimuthRad and minElevationRad');
    }
  }
  const sorted = [...table].sort((a, b) => a.azimuthRad - b.azimuthRad);

  // g(et) = elevation(et) - floor(azimuth(et)); access is where g >= 0. Elevation and azimuth are
  // the latitude/longitude of the observer-to-target unit vector in the facility's body-fixed
  // frame, the same convention gfposc uses for the constant case.
  const g = async (et: number): Promise<number> => {
    const { position } = await spice.spkpos(target, et, facility.bodyFrame, abcorr, facility.body);
    const m = Math.sqrt(dot(position, position)) || 1;
    const z = position.z / m;
    const elevation = Math.asin(Math.max(-1, Math.min(1, z)));
    const azimuth = Math.atan2(position.y, position.x);
    return elevation - interpolateMaskFloor(sorted, azimuth);
  };
  return findConstraintWindow(g, span, step);
}
