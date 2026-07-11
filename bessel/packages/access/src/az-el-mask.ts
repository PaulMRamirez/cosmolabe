// Azimuth-elevation mask access: a ground facility sees the target only when the target's
// TOPOCENTRIC elevation (above the local geodetic horizon at the site's lon/lat/alt) clears a
// (possibly azimuth-dependent) horizon mask. Two regimes:
//   - a single constant `minElevationRad` floor is the plain elevation-access constraint, so it
//     delegates to computeElevationAccess (correct topocentric geodetic elevation at the site);
//   - an azimuth-indexed `mask` table (a polygonal skyline) has no single floor, so it is reduced
//     to the shared scalar finder with g(et) = elevation(et) - floor(azimuth(et)), the floor
//     linearly interpolated around the azimuth circle.
// Both regimes use the facility's TOPOCENTRIC frame at its geodetic lon/lat/alt, not the body
// center: elevation is the angle above the local geodetic horizon and azimuth is measured from
// local north toward east. (STK_PARITY_SPEC §4.3, ACC az-el mask.)

import type { AberrationCorrection, SpiceEngine } from '@bessel/spice';
import { findConstraintWindow, type EphemerisTime, type Window } from '@bessel/timeline';
import {
  bodyRadiiKm,
  computeElevationAccess,
  facilityTopoFrame,
  topocentricElAz,
  type Facility,
} from './facility.ts';

/** One vertex of an azimuth-indexed elevation mask: a minimum elevation at an azimuth. */
export interface MaskPoint {
  /** Azimuth (rad), measured from local north toward east, in [-pi, pi]. */
  readonly azimuthRad: number;
  /** Minimum acceptable elevation (rad) at this azimuth. */
  readonly minElevationRad: number;
}

/**
 * An azimuth-elevation mask constraint at a ground facility: the target must be at or above the
 * horizon mask. Provide exactly one of `minElevationRad` (a constant floor at every azimuth) or
 * `mask` (an azimuth-indexed table interpolated around the circle). Elevation and azimuth are the
 * TOPOCENTRIC elevation and azimuth at the facility's geodetic site, not the body center.
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

const TWO_PI = 2 * Math.PI;

// Normalise an angle into [0, 2pi).
const norm2pi = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/**
 * Linearly interpolate the mask floor (rad) at an azimuth (rad), treating the table as a closed
 * loop around the azimuth circle. The table is assumed sorted ascending by azimuth, but is robust
 * to a table whose azimuths span up to 2*pi, wrap across +-pi, or contain duplicate vertices: both
 * the query and every comparison are normalised relative to the first vertex into [0, 2*pi), and
 * the wrap-around segment (last vertex -> first vertex + 2*pi) is handled explicitly.
 */
export function interpolateMaskFloor(mask: readonly MaskPoint[], azimuthRad: number): number {
  const n = mask.length;
  if (n === 1) return mask[0]!.minElevationRad;
  const base = mask[0]!.azimuthRad;
  // Each vertex offset (and the query) measured from the first vertex, in [0, 2*pi). The first
  // vertex maps to 0; later vertices wrap monotonically, and the closing segment runs to 2*pi.
  const az = norm2pi(azimuthRad - base);
  for (let i = 0; i < n; i++) {
    const a = mask[i]!;
    const next = mask[(i + 1) % n]!;
    const aAz = norm2pi(a.azimuthRad - base);
    // The closing segment (i === n - 1) spans from the last offset up to a full turn.
    const bAz = i === n - 1 ? TWO_PI : norm2pi(next.azimuthRad - base);
    // A degenerate (duplicate-azimuth) segment has zero width; skip it rather than divide by zero.
    if (bAz <= aAz) continue;
    if (az >= aAz && az <= bAz) {
      const frac = (az - aAz) / (bAz - aAz);
      return a.minElevationRad + frac * (next.minElevationRad - a.minElevationRad);
    }
  }
  return mask[n - 1]!.minElevationRad; // unreachable given the closed-loop normalisation
}

/**
 * Compute the Window over `span` where the target clears the facility's azimuth-elevation mask.
 * A constant floor delegates to the topocentric elevation-access constraint; a mask table builds
 * the facility's topocentric frame once and runs the shared scalar finder against the interpolated
 * floor at the topocentric azimuth. Fails loud on an empty or ill-formed mask, or if neither /
 * both of `minElevationRad` and `mask` are given.
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

  if (haveConst) {
    if (!Number.isFinite(minElevationRad)) {
      throw new AzElMaskConstraintError(`minElevationRad must be finite, got ${minElevationRad}`);
    }
    // A constant floor is exactly the topocentric elevation-access constraint at the site.
    return computeElevationAccess(spice, facility, target, span, step, minElevationRad as number, abcorr);
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

  // Build the facility's topocentric frame once from the body's radii, then per epoch sample the
  // target in the body-fixed frame and reduce to a topocentric (elevation, azimuth).
  const { equatorialKm: re, polarKm: rp } = await bodyRadiiKm(spice, facility.body);
  const frame = facilityTopoFrame(facility, re, rp);

  // g(et) = elevation(et) - floor(azimuth(et)); access is where g >= 0. Elevation and azimuth are
  // the topocentric coordinates of the site-to-target vector, matching the constant-floor case.
  const g = async (et: number): Promise<number> => {
    const { position } = await spice.spkpos(target, et, facility.bodyFrame, abcorr, facility.body);
    const { elevationRad, azimuthRad } = topocentricElAz(frame, position);
    return elevationRad - interpolateMaskFloor(sorted, azimuthRad);
  };
  return findConstraintWindow(g, span, step);
}
