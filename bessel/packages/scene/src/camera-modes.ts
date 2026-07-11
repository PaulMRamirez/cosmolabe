// Camera mode math. Orbit and center are spherical; track places the camera
// behind the focus velocity looking down-track. Pure so it is unit tested.

import { type Km3 } from './geometry-builders.ts';

export type CameraMode = 'orbit' | 'center' | 'track';

/**
 * Track camera position (scene units, relative to the focus at the origin): behind
 * the velocity direction, raised by elevationBias. Returns a safe default when the
 * velocity is near zero.
 */
export function computeTrackCameraPosition(
  velocityKm: Km3,
  distance: number,
  elevationBias = 0.3,
): [number, number, number] {
  const m = Math.hypot(velocityKm[0], velocityKm[1], velocityKm[2]);
  if (m < 1e-9) return [distance, distance * elevationBias, 0];
  const vx = velocityKm[0] / m;
  const vy = velocityKm[1] / m;
  const vz = velocityKm[2] / m;
  // Behind the velocity (minus v-hat), lifted along +Y.
  const back: [number, number, number] = [-vx, -vy + elevationBias, -vz];
  const bm = Math.hypot(back[0], back[1], back[2]) || 1;
  return [(back[0] / bm) * distance, (back[1] / bm) * distance, (back[2] / bm) * distance];
}

/**
 * Inverse of computeOrbitCameraPosition for the "set the view from a vector"
 * control (Cosmographia parity): given a world-space direction the camera should
 * look ALONG (toward the focus), return the azimuth and elevation that place the
 * camera opposite that direction. A near-zero vector yields a safe default.
 */
export function azimuthElevationFromDirection(direction: Km3): {
  azimuth: number;
  elevation: number;
} {
  const m = Math.hypot(direction[0], direction[1], direction[2]);
  if (m < 1e-9) return { azimuth: 0, elevation: 0 };
  // The camera sits opposite the look direction (it looks toward the origin), so
  // negate the direction to get the camera position direction.
  const px = -direction[0] / m;
  const py = -direction[1] / m;
  const pz = -direction[2] / m;
  return {
    azimuth: Math.atan2(pz, px),
    elevation: Math.asin(Math.max(-1, Math.min(1, py))),
  };
}

/** Spherical orbit position from azimuth, elevation, distance (scene units). */
export function computeOrbitCameraPosition(
  azimuth: number,
  elevation: number,
  distance: number,
): [number, number, number] {
  const ce = Math.cos(elevation);
  return [
    distance * ce * Math.cos(azimuth),
    distance * Math.sin(elevation),
    distance * ce * Math.sin(azimuth),
  ];
}

/**
 * Dolly factor (Cosmographia dollyForward / dollyBackward): translate the camera
 * along its view axis toward (forward > 0) or away from (forward < 0) the focus.
 * In the orbit model the view axis points at the focus, so a dolly is a distance
 * change; this returns the multiplicative distance factor for a fractional step.
 * exp keeps the step symmetric in log-distance (matching the wheel's feel) and
 * strictly positive, so a forward dolly approaches the focus without crossing it.
 * This is a true camera translation, not a field-of-view (lens) change.
 */
export function dollyFactor(forwardFraction: number): number {
  return Math.exp(-forwardFraction);
}

/**
 * Crane offset (Cosmographia craneUp / craneDown): a vertical screen-plane shift,
 * perpendicular to the view axis, expressed as a pan-Y fraction of the distance.
 * Positive raises the viewpoint. Returned as a fraction so it composes with the
 * existing truck/pan channel rather than introducing a second offset basis.
 */
export function craneOffsetFraction(upFraction: number): number {
  return upFraction;
}
