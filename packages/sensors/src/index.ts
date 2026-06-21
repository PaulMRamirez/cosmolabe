// @bessel/sensors: sensor field-of-view geometry and footprints. Pure: point-in-FOV
// test, conic boundary generation, and ray-ellipsoid/sphere intersection for the
// ground footprint. The scene renders the geometry; the engine supplies pointing
// from attitude. (STK_PARITY_SPEC §4.7.)

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mag = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const unit = (a: Vec3): Vec3 => {
  const m = mag(a) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};

/** Angle (rad) between a line of sight and the boresight, numerically robust. */
export function offBoresightAngle(los: Vec3, boresight: Vec3): number {
  return Math.atan2(mag(cross(los, boresight)), dot(los, boresight));
}

/** Whether a line of sight falls within a circular (conic) field of view. */
export function pointInConicFov(los: Vec3, boresight: Vec3, halfAngleRad: number): boolean {
  return offBoresightAngle(los, boresight) <= halfAngleRad;
}

/** A vector perpendicular to n (for building a cone basis). */
function perpendicular(n: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  return unit(cross(ref, n));
}

/** Sample `samples` boundary rays (unit) of a conic FOV about the boresight. */
export function conicBoundary(boresight: Vec3, halfAngleRad: number, samples = 64): Vec3[] {
  const b = unit(boresight);
  const u = perpendicular(b);
  const v = cross(b, u);
  const ca = Math.cos(halfAngleRad);
  const sa = Math.sin(halfAngleRad);
  const out: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * 2 * Math.PI;
    out.push(add(scale(b, ca), add(scale(u, sa * Math.cos(t)), scale(v, sa * Math.sin(t)))));
  }
  return out;
}

/** Nearest intersection of a ray with a sphere, or null if it misses. */
export function raySphereIntersect(origin: Vec3, dir: Vec3, center: Vec3, radius: number): Vec3 | null {
  const d = unit(dir);
  const oc = sub(origin, center);
  const b = dot(oc, d);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); // nearest root
  if (t < 0) return null;
  return add(origin, scale(d, t));
}

export interface Footprint {
  /** Surface points (one per boundary ray that hits the body). */
  readonly points: Vec3[];
  /** Boundary rays that missed the body (limb-crossing indicator). */
  readonly misses: number;
}

/**
 * Footprint of a conic sensor on a sphere: intersect each boundary ray from the
 * sensor apex with the sphere. Rays past the limb miss and are counted.
 */
export function footprintOnSphere(
  apex: Vec3,
  boresight: Vec3,
  halfAngleRad: number,
  center: Vec3,
  radius: number,
  samples = 64,
): Footprint {
  const points: Vec3[] = [];
  let misses = 0;
  for (const ray of conicBoundary(boresight, halfAngleRad, samples)) {
    const hit = raySphereIntersect(apex, ray, center, radius);
    if (hit) points.push(hit);
    else misses++;
  }
  return { points, misses };
}

export {
  loadInstrumentFov,
  fovConeRim,
  footprintFromFov,
  type InstrumentFov,
  type FootprintContext,
  type Vec3Tuple,
} from './footprint-spice.ts';

export {
  accumulateSwath,
  swathCovers,
  swathCoverageFraction,
  type SensorSchema,
  type SwathSample,
  type Swath,
  type SwathOccluder,
} from './swath.ts';
