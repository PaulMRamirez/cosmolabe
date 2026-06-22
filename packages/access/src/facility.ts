// Ground-facility access by elevation. The facility's body-fixed position and local
// vertical come from its geodetic coordinates (pure ellipsoid math); the target's
// elevation is sampled in the body-fixed frame and the in-view window is found by
// sampling + bisection (the native geometry-finder for this derived constraint).
// (STK_PARITY_SPEC §4.3, ACC-5.)

import type { AberrationCorrection, SpiceEngine, Vec3 } from '@bessel/spice';
import { findConstraintWindow, type EphemerisTime, type Window } from '@bessel/timeline';

/**
 * The body's equatorial and polar radii (km) from RADII (RADII[0] and RADII[2]). One shared
 * reader for the az-el mask, the elevation access, and the terrain LOS, so the bodvrd call and
 * the positive-radius validation live in one place. Throws a located error when either radius is
 * missing or non-positive (a body with no usable triaxial radii cannot define a horizon).
 */
export async function bodyRadiiKm(
  spice: SpiceEngine,
  body: string,
): Promise<{ equatorialKm: number; polarKm: number }> {
  const radii = await spice.bodvrd(body, 'RADII');
  const equatorialKm = radii[0];
  const polarKm = radii[2];
  if (equatorialKm === undefined || !(equatorialKm > 0) || polarKm === undefined || !(polarKm > 0)) {
    throw new FacilityRadiiError(`body ${body} has no positive RADII`);
  }
  return { equatorialKm, polarKm };
}

/** A typed, located error for a body whose RADII are missing or non-positive. */
export class FacilityRadiiError extends Error {
  override readonly name = 'FacilityRadiiError';
  constructor(message: string) {
    super(`@bessel/access radii: ${message}`);
  }
}

export interface Facility {
  /** Central body (e.g. "EARTH") whose body-fixed frame the facility sits in. */
  readonly body: string;
  /** Body-fixed frame (e.g. "IAU_EARTH"). */
  readonly bodyFrame: string;
  readonly lonRad: number;
  readonly latRad: number;
  readonly altKm: number;
}

/** Dot product of two body-fixed vectors. */
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
/** Component difference a - b. */
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
/** Unit vector (the zero vector maps to itself, guarded against a divide by zero). */
export const unit = (a: Vec3): Vec3 => {
  const m = Math.sqrt(dot(a, a)) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};
/** Cross product a x b. */
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Geodetic (lon, lat, alt) to body-fixed rectangular (km) on an ellipsoid. */
function geodeticToRect(fac: Facility, re: number, f: number): Vec3 {
  const e2 = f * (2 - f);
  const sLat = Math.sin(fac.latRad);
  const cLat = Math.cos(fac.latRad);
  const n = re / Math.sqrt(1 - e2 * sLat * sLat);
  return {
    x: (n + fac.altKm) * cLat * Math.cos(fac.lonRad),
    y: (n + fac.altKm) * cLat * Math.sin(fac.lonRad),
    z: (n * (1 - e2) + fac.altKm) * sLat,
  };
}

/**
 * Outward GEODETIC normal (local up) at the facility, in the body-fixed frame. This is the
 * ellipsoid surface normal at the site's GEODETIC latitude (the up of a standard topocentric
 * SEZ frame), NOT the geocentric radial direction from the body center. The two differ by up to
 * ~0.19 deg at mid-latitude on Earth, which shifts the horizon and hence the elevation of a
 * grazing pass; STK's topocentric elevation uses this same geodetic up. We deliberately adopt
 * the geodetic-normal convention so a low-elevation/grazing pass matches an STK topocentric
 * result. (See `geocentricNormal` for the geocentric-radial alternative.)
 */
function geodeticNormal(fac: Facility): Vec3 {
  const cLat = Math.cos(fac.latRad);
  return { x: cLat * Math.cos(fac.lonRad), y: cLat * Math.sin(fac.lonRad), z: Math.sin(fac.latRad) };
}

/**
 * Outward GEOCENTRIC normal (radial from the body center) at the facility's body-fixed position.
 * The cheap alternative to the geodetic normal: up points straight away from the center rather
 * than perpendicular to the ellipsoid. Selected with `up: 'geocentric'`; the default is the
 * geodetic (STK topocentric) convention.
 */
function geocentricNormal(facPos: Vec3): Vec3 {
  return unit(facPos);
}

/** Which local-up convention defines elevation: geodetic (STK topocentric) or geocentric. */
export type ElevationUp = 'geodetic' | 'geocentric';

/**
 * Compute the intervals over [start, stop] during which `target` is at or above
 * `minElevationRad` as seen from the facility. Elevation is the angle of the line-of-sight
 * above the local horizon. The horizon is defined by the local up vector: by default the
 * GEODETIC normal (the ellipsoid surface normal, the up of a topocentric SEZ frame, matching
 * STK's topocentric elevation), which differs from the geocentric radial by up to ~0.19 deg at
 * mid-latitude and so shifts a grazing pass. Pass `up: 'geocentric'` to use the body-centered
 * radial direction instead.
 */
export async function computeElevationAccess(
  spice: SpiceEngine,
  facility: Facility,
  target: string,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  minElevationRad: number,
  abcorr: AberrationCorrection = 'NONE',
  up: ElevationUp = 'geodetic',
): Promise<Window> {
  const { equatorialKm: re, polarKm: rp } = await bodyRadiiKm(spice, facility.body);
  const facPos = geodeticToRect(facility, re, (re - rp) / re);
  const upVec = up === 'geocentric' ? geocentricNormal(facPos) : geodeticNormal(facility);

  // g(et) = elevation - minElevation; access is where g >= 0. The shared geometry
  // finder scans and refines the crossings.
  const g = async (et: number): Promise<number> => {
    const t = await spice.spkpos(target, et, facility.bodyFrame, abcorr, facility.body);
    const los = unit(sub(t.position, facPos));
    return Math.asin(Math.max(-1, Math.min(1, dot(los, upVec)))) - minElevationRad;
  };
  return findConstraintWindow(g, span, step);
}

/**
 * The topocentric (local) frame at a facility, in the body-fixed frame: the site position
 * plus an orthonormal up/east/north triad. `up` is the GEODETIC normal (the STK topocentric
 * vertical); `east` points along the local parallel toward increasing longitude; `north`
 * completes the right-handed set. Azimuth is measured from `north` toward `east`.
 */
export interface TopoFrame {
  /** Site position in the body-fixed frame (km). */
  readonly pos: Vec3;
  /** Local up: the geodetic ellipsoid normal (unit). */
  readonly up: Vec3;
  /** Local east: along the parallel toward increasing longitude (unit). */
  readonly east: Vec3;
  /** Local north: up x east, toward the body's spin pole (unit). */
  readonly north: Vec3;
}

/**
 * Build the topocentric frame at a facility from the body's equatorial (`re`) and polar (`rp`)
 * radii. The east axis is unit(zSpin x up); at a geographic pole `up` is parallel to the spin
 * axis so that cross product degenerates, and we fall back to the body-fixed +X meridian as
 * east (an arbitrary but stable azimuth origin where azimuth is otherwise undefined).
 */
export function facilityTopoFrame(facility: Facility, re: number, rp: number): TopoFrame {
  const pos = geodeticToRect(facility, re, (re - rp) / re);
  const up = geodeticNormal(facility);
  const zSpin: Vec3 = { x: 0, y: 0, z: 1 };
  const eastRaw = cross(zSpin, up);
  const eastMag = Math.sqrt(dot(eastRaw, eastRaw));
  // Pole-degenerate fallback: up || spin axis, so east is undefined; use the +X meridian.
  const east = eastMag > 1e-12 ? unit(eastRaw) : { x: 1, y: 0, z: 0 };
  const north = cross(up, east);
  return { pos, up, east, north };
}

/**
 * Topocentric elevation and azimuth of a body-fixed target point as seen from a facility's
 * topocentric frame. Elevation is asin(los . up); azimuth is measured from north toward east
 * (atan2(los . east, los . north)), normalized to [-pi, pi].
 */
export function topocentricElAz(
  frame: TopoFrame,
  targetPosBodyFixed: Vec3,
): { elevationRad: number; azimuthRad: number } {
  const los = unit(sub(targetPosBodyFixed, frame.pos));
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, dot(los, frame.up))));
  const azimuthRad = Math.atan2(dot(los, frame.east), dot(los, frame.north));
  return { elevationRad, azimuthRad };
}
