// Typed sensor schema and time-evolving swath accumulation: sample a sensor's
// footprint along a trajectory and accumulate the boundary rings (for rendering) and
// the covered region (for a coverage metric). Builds on the pure FOV/footprint
// geometry. (STK_PARITY_SPEC §4.7.)

import { footprintOnSphere, pointInConicFov, raySphereIntersect, type Vec3 } from './index.ts';

/** A typed sensor definition. Conic (circular FOV) for now; rectangular can extend this. */
export interface SensorSchema {
  readonly name: string;
  readonly kind: 'conic';
  /** Circular field-of-view half-angle (rad). */
  readonly halfAngleRad: number;
}

/** One sample along the trajectory: the sensor apex and its boresight direction. */
export interface SwathSample {
  readonly apex: Vec3;
  readonly boresight: Vec3;
}

export interface Swath {
  /** One footprint boundary ring (surface points) per sample. */
  readonly rings: Vec3[][];
  /** Every surface boundary point, flattened (for a swath ribbon / point cloud). */
  readonly points: Vec3[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The body the swath falls on, used to reject far-side / limb-occluded points. */
export interface SwathOccluder {
  readonly center: Vec3;
  readonly radius: number;
}

/**
 * Whether a surface `point` is actually visible from the sensor `apex` past the body: the
 * point's outward normal must face the apex (it is on the near hemisphere), and the
 * apex->point ray's first sphere hit must be the point itself (the limb does not occlude it).
 * Without this gate a wide-FOV nadir sensor "covers" points on the far hemisphere that lie
 * inside the cone but behind the body.
 */
function pointVisibleFromApex(point: Vec3, apex: Vec3, occ: SwathOccluder): boolean {
  // Near-hemisphere test: outward surface normal (point - center) must point toward the apex.
  const normal = sub(point, occ.center);
  const toApex = sub(apex, point);
  if (dot(normal, toApex) <= 0) return false;
  // Occlusion test: the first sphere intersection along apex->point must be the point, not an
  // earlier limb crossing. Compare the nearest hit to the target point within a small tolerance
  // scaled by the body radius.
  const dir = sub(point, apex);
  const hit = raySphereIntersect(apex, dir, occ.center, occ.radius);
  if (!hit) return false;
  const tol = 1e-6 * (occ.radius || 1);
  const gap = Math.hypot(hit.x - point.x, hit.y - point.y, hit.z - point.z);
  return gap <= tol;
}

/**
 * Accumulate the sensor footprint over a sequence of samples on a sphere: the per-
 * sample boundary rings and their flattened points.
 */
export function accumulateSwath(
  samples: readonly SwathSample[],
  schema: SensorSchema,
  center: Vec3,
  radius: number,
  ringSamples = 32,
): Swath {
  const rings = samples.map(
    (s) => footprintOnSphere(s.apex, s.boresight, schema.halfAngleRad, center, radius, ringSamples).points,
  );
  return { rings, points: rings.flat() };
}

/**
 * Whether any sample's FOV cone contains the line of sight to `point`. When `occluder` is
 * given, a sample only counts if `point` is also geometrically visible from that sample's apex
 * (near hemisphere, not behind the limb): the FOV cone alone over-reports for a wide-FOV nadir
 * sensor whose cone wraps past the body's limb onto the far side.
 */
export function swathCovers(
  point: Vec3,
  samples: readonly SwathSample[],
  schema: SensorSchema,
  occluder?: SwathOccluder,
): boolean {
  return samples.some(
    (s) =>
      pointInConicFov(sub(point, s.apex), s.boresight, schema.halfAngleRad) &&
      (occluder === undefined || pointVisibleFromApex(point, s.apex, occluder)),
  );
}

/** Fraction of `testPoints` covered by the swath at any sample (a coverage metric). */
export function swathCoverageFraction(
  testPoints: readonly Vec3[],
  samples: readonly SwathSample[],
  schema: SensorSchema,
  occluder?: SwathOccluder,
): number {
  if (testPoints.length === 0) return 0;
  let covered = 0;
  for (const p of testPoints) if (swathCovers(p, samples, schema, occluder)) covered += 1;
  return covered / testPoints.length;
}
