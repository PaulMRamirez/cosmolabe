// Precomputes body positions over the demo window so playback interpolates on the
// main thread instead of making a SPICE worker round-trip per body per frame.
// Positions are kilometres relative to the Sun (body 10) in J2000.
import type { SpiceEngine } from '@bessel/spice';
import type { Km3 } from '@bessel/scene';

export interface BodyRef {
  readonly name: string;
  readonly spiceId: string;
}

export interface EphemerisTable {
  readonly et0: number;
  readonly et1: number;
  readonly steps: number;
  readonly times: Float64Array;
  /** name -> flat [x,y,z] per step (length steps*3). */
  readonly byBody: ReadonlyMap<string, Float64Array>;
}

export async function sampleEphemeris(
  spice: SpiceEngine,
  bodies: readonly BodyRef[],
  et0: number,
  et1: number,
  steps: number,
  observer = '10',
): Promise<EphemerisTable> {
  const times = new Float64Array(steps);
  for (let k = 0; k < steps; k++) times[k] = et0 + ((et1 - et0) * k) / (steps - 1);

  const byBody = new Map<string, Float64Array>();
  await Promise.all(
    bodies.map(async (body) => {
      const flat = new Float64Array(steps * 3);
      const results = await Promise.all(
        Array.from({ length: steps }, (_, k) =>
          spice.spkpos(body.spiceId, times[k]!, 'J2000', 'NONE', observer),
        ),
      );
      results.forEach((r, k) => {
        flat[k * 3] = r.position.x;
        flat[k * 3 + 1] = r.position.y;
        flat[k * 3 + 2] = r.position.z;
      });
      byBody.set(body.name, flat);
    }),
  );

  return { et0, et1, steps, times, byBody };
}

/** Linearly interpolate a body position at ephemeris time et. */
export function positionAt(table: EphemerisTable, name: string, et: number): Km3 {
  const flat = table.byBody.get(name);
  if (!flat) return [0, 0, 0];
  // A degenerate window (et1 === et0) would make the interpolation fraction 0/0 =
  // NaN; with a single epoch there is one sample to return, so return it directly.
  if (table.et1 === table.et0 || table.steps <= 1) return [flat[0]!, flat[1]!, flat[2]!];
  const clamped = Math.max(table.et0, Math.min(table.et1, et));
  const f = ((clamped - table.et0) / (table.et1 - table.et0)) * (table.steps - 1);
  const i = Math.min(table.steps - 2, Math.floor(f));
  const t = f - i;
  const a = i * 3;
  const b = (i + 1) * 3;
  return [
    flat[a]! + (flat[b]! - flat[a]!) * t,
    flat[a + 1]! + (flat[b + 1]! - flat[a + 1]!) * t,
    flat[a + 2]! + (flat[b + 2]! - flat[a + 2]!) * t,
  ];
}

/** Finite-difference velocity (km/s) of a body at et, from the sampled table. */
export function velocityAt(table: EphemerisTable, name: string, et: number): Km3 {
  // positionAt clamps its epoch to [et0, et1]. At a window edge the stencil epochs
  // collapse onto that bound (e.g. at et0 the back sample clamps to et0), so a fixed
  // /2 divisor would halve the span actually spanned and report ~2x speed. Divide by
  // the real span between the two clamped epochs instead. Guard a zero span (a
  // degenerate single-sample window) by returning zero velocity.
  const lo = Math.max(table.et0, Math.min(table.et1, et - 1));
  const hi = Math.max(table.et0, Math.min(table.et1, et + 1));
  const span = hi - lo;
  if (span <= 0) return [0, 0, 0];
  const a = positionAt(table, name, lo);
  const b = positionAt(table, name, hi);
  return [(b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span];
}

/**
 * Range rate (km/s) between two bodies at positions a and b with velocities va
 * and vb: the component of relative velocity along the line of sight. Negative is
 * closing (approaching), positive is separating. Returns 0 for coincident points.
 */
export function rangeRate(a: Km3, b: Km3, va: Km3, vb: Km3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-12) return 0;
  const rvx = va[0] - vb[0];
  const rvy = va[1] - vb[1];
  const rvz = va[2] - vb[2];
  return (dx * rvx + dy * rvy + dz * rvz) / dist;
}

/** Build a polyline (km, relative to Sun) from a body's samples. */
export function trajectoryOf(table: EphemerisTable, name: string): Km3[] {
  const flat = table.byBody.get(name);
  if (!flat) return [];
  const points: Km3[] = [];
  for (let k = 0; k < table.steps; k++) {
    points.push([flat[k * 3]!, flat[k * 3 + 1]!, flat[k * 3 + 2]!]);
  }
  return points;
}
