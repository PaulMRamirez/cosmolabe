// Impulsive maneuvers in the standard attitude frames (J2000, VNB, RIC/RTN, LVLH).
// Pure linear algebra: build the orthonormal frame basis from the state, rotate the
// delta-v into inertial, and add it to the velocity. (STK_PARITY_SPEC §4.2, MNVR-1.)

import type { Vec3 } from './lambert.ts';

export interface CartesianState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export type ManeuverFrame = 'J2000' | 'VNB' | 'RIC' | 'LVLH';

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: Vec3): Vec3 => {
  const m = Math.sqrt(dot(a, a)) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export interface FrameBasis {
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
}

/** Orthonormal basis (inertial coordinates) of a maneuver frame at the state. */
export function frameBasis(state: CartesianState, frame: ManeuverFrame): FrameBasis {
  if (frame === 'J2000') return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
  const rhat = unit(state.position);
  const nhat = unit(cross(state.position, state.velocity)); // orbit normal
  if (frame === 'RIC') {
    // Radial, In-track (transverse), Cross-track.
    return { x: rhat, y: cross(nhat, rhat), z: nhat };
  }
  if (frame === 'VNB') {
    // Velocity, Normal, Bi-normal.
    const vhat = unit(state.velocity);
    return { x: vhat, y: nhat, z: cross(vhat, nhat) };
  }
  // LVLH: z toward nadir (-r), y along -orbit-normal, x completes (~velocity).
  const z = scale(rhat, -1);
  const y = scale(nhat, -1);
  return { x: cross(y, z), y, z };
}

/** Rotate a frame-relative vector into inertial coordinates. */
function toInertial(v: Vec3, b: FrameBasis): Vec3 {
  return add(add(scale(b.x, v.x), scale(b.y, v.y)), scale(b.z, v.z));
}

/**
 * Apply an impulsive maneuver: `dv` is expressed in `frame` (km/s). Returns the new
 * state (position unchanged, velocity incremented by the inertial delta-v).
 */
export function applyImpulsiveManeuver(state: CartesianState, dv: Vec3, frame: ManeuverFrame): CartesianState {
  const dvInertial = toInertial(dv, frameBasis(state, frame));
  return { position: state.position, velocity: add(state.velocity, dvInertial) };
}

/** Magnitude (km/s) of a delta-v vector. */
export function deltaVMagnitude(dv: Vec3): number {
  return Math.sqrt(dot(dv, dv));
}
