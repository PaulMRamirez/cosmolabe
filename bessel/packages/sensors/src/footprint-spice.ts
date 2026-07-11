// SPICE-driven instrument geometry: read an instrument field of view (getfov),
// build a nadir-pointed FOV cone rim, and intercept the FOV corner rays on the
// target body (sincpt) for an exact ellipsoid footprint. This is the catalog-driven
// sensor footprint, kept in core (testable, reusable) rather than in the app shell.
// Frame-agnostic in its vector inputs; the caller supplies coordinates. (STK §4.7.)

import type { SpiceEngine, Vec3 } from '@bessel/spice';

/** A plain 3-vector tuple (km) in whatever frame the caller works in. */
export type Vec3Tuple = readonly [number, number, number];

const sub = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3Tuple, s: number): Vec3Tuple => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3Tuple): Vec3Tuple => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};
const toTuple = (v: Vec3): Vec3Tuple => [v.x, v.y, v.z];

export interface InstrumentFov {
  readonly boresight: Vec3Tuple;
  readonly bounds: readonly Vec3Tuple[];
}

/** Where an instrument points: the SPICE ids and body-fixed frame for footprints. */
export interface FootprintContext {
  /** Observer (the spacecraft) SPICE id, e.g. "-82". */
  readonly observerId: string;
  /** Target body SPICE id for sincpt, e.g. "699". */
  readonly targetId: string;
  /** Target body-fixed frame for sincpt, e.g. "IAU_SATURN". */
  readonly targetFrame: string;
}

/** Read an instrument's FOV (getfov) and normalize the boresight and corner rays. */
export async function loadInstrumentFov(spice: SpiceEngine, instId: number): Promise<InstrumentFov> {
  const fov = await spice.getfov(instId);
  return { boresight: norm(toTuple(fov.boresight)), bounds: fov.bounds.map(toTuple) };
}

/** Build an orthonormal frame with the given +Z axis. */
function frameFromZ(z: Vec3Tuple): { x: Vec3Tuple; y: Vec3Tuple; z: Vec3Tuple } {
  const ref: Vec3Tuple = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const x = norm(cross(ref, z));
  const y = cross(z, x);
  return { x, y, z };
}

/** Map an FOV vector (instrument frame, boresight = +Z) into a world frame. */
function toWorld(v: Vec3Tuple, frame: { x: Vec3Tuple; y: Vec3Tuple; z: Vec3Tuple }): Vec3Tuple {
  return add(add(scale(frame.x, v[0]), scale(frame.y, v[1])), scale(frame.z, v[2]));
}

/**
 * FOV cone rim points emanating from `spacecraft` toward `target`, capped at
 * `maxLengthKm` so a distant target does not make the cone fill the view edge-on. The
 * boresight is pointed nadir (spacecraft to target). Inputs and outputs share the
 * caller's frame (e.g. heliocentric km).
 */
export function fovConeRim(
  spacecraft: Vec3Tuple,
  target: Vec3Tuple,
  fov: InstrumentFov,
  maxLengthKm: number,
): Vec3Tuple[] {
  const frame = frameFromZ(norm(sub(target, spacecraft)));
  const range = Math.hypot(...sub(target, spacecraft));
  const length = Math.min(range, maxLengthKm);
  return fov.bounds.map((b) => add(spacecraft, scale(norm(toWorld(b, frame)), length)));
}

/**
 * Observation footprint: intercept each FOV corner ray on the target ellipsoid
 * (sincpt) and return the surface points in J2000 relative to the target center (km).
 * The boresight uses the exact spacecraft-to-target direction at `et`. Returns [] if
 * any corner ray misses the body (a limb crossing).
 */
export async function footprintFromFov(
  spice: SpiceEngine,
  et: number,
  fov: InstrumentFov,
  ctx: FootprintContext,
): Promise<Vec3Tuple[]> {
  const dir = await spice.spkpos(ctx.targetId, et, 'J2000', 'NONE', ctx.observerId);
  const frame = frameFromZ(norm([dir.position.x, dir.position.y, dir.position.z]));
  const points: Vec3Tuple[] = [];
  for (const b of fov.bounds) {
    const ray = norm(toWorld(b, frame));
    const hit = await spice.sincpt(
      'ELLIPSOID',
      ctx.targetId,
      et,
      ctx.targetFrame,
      'NONE',
      ctx.observerId,
      'J2000',
      { x: ray[0], y: ray[1], z: ray[2] },
    );
    if (!hit.found) return [];
    const rot = await spice.pxform(ctx.targetFrame, 'J2000', hit.trgepc);
    const p = hit.point;
    points.push([
      rot[0]! * p.x + rot[1]! * p.y + rot[2]! * p.z,
      rot[3]! * p.x + rot[4]! * p.y + rot[5]! * p.z,
      rot[6]! * p.x + rot[7]! * p.y + rot[8]! * p.z,
    ]);
  }
  return points;
}
