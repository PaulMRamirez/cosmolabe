// @bessel/events: solar beta angle. Pure geometry on top of spkezr/spkpos (no new
// SPICE bindings). The beta angle is the angle between the Sun direction (from the
// central body) and the observer's orbit plane about that body; it is the elevation
// of the Sun above the orbit plane, signed by the orbit normal. Bounded [-90, +90]
// degrees. Core layer: depends only on @bessel/spice. (Phase B.)

import type { AberrationCorrection, SpiceEngine, Vec3 } from '@bessel/spice';

const DEG_PER_RAD = 180 / Math.PI;
/** Below this the orbit normal |h| = |r x v| is treated as degenerate (km^2/s). */
const MIN_NORM = 1e-9;

/** Raised when the observer state cannot define an orbit plane about the body. */
export class DegenerateOrbitError extends Error {
  constructor(
    message: string,
    readonly observer: string,
    readonly centerBody: string,
    readonly et: number,
  ) {
    super(message);
    this.name = 'DegenerateOrbitError';
  }
}

/** A beta-angle time series: parallel epoch and value (degrees) columns. */
export interface BetaAngleSeries {
  readonly et: Float64Array;
  readonly valueDeg: Float64Array;
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const norm = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Clamp the dot of two unit vectors into [-1, 1] before asin (guards rounding). */
const clampUnit = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);

/**
 * Solar beta angle (degrees) of `observer` about `centerBody` at `et`.
 *
 * The orbit normal h = r x v is taken from spkezr(observer wrt centerBody); the Sun
 * direction s from spkpos(SUN wrt centerBody). beta = asin(s_hat . h_hat), signed by
 * the orbit normal. The result is bounded [-90, +90].
 *
 * Throws {@link DegenerateOrbitError} when the orbit normal is ~ 0 (a radial or
 * null state cannot define an orbit plane).
 */
export async function betaAngle(
  spice: SpiceEngine,
  observer: string,
  centerBody: string,
  et: number,
  abcorr: AberrationCorrection = 'NONE',
): Promise<number> {
  const state = await spice.spkezr(observer, et, 'J2000', abcorr, centerBody);
  const h = cross(state.position, state.velocity);
  const hMag = norm(h);
  if (hMag < MIN_NORM) {
    throw new DegenerateOrbitError(
      `betaAngle: degenerate orbit for ${observer} about ${centerBody} at et=${et}; |r x v|=${hMag} (radial or null state)`,
      observer,
      centerBody,
      et,
    );
  }
  const sun = await spice.spkpos('SUN', et, 'J2000', abcorr, centerBody);
  const sMag = norm(sun.position);
  if (sMag < MIN_NORM) {
    throw new DegenerateOrbitError(
      `betaAngle: degenerate Sun direction from ${centerBody} at et=${et}; |s|=${sMag}`,
      observer,
      centerBody,
      et,
    );
  }
  const sinBeta = clampUnit(dot(sun.position, h) / (sMag * hMag));
  return Math.asin(sinBeta) * DEG_PER_RAD;
}

/**
 * Sample {@link betaAngle} over [et0, et1] at the given step (s). The last sample
 * lands on or just before et1; `step` must be positive. Each sample propagates the
 * DegenerateOrbitError loudly.
 */
export async function betaAngleSeries(
  spice: SpiceEngine,
  observer: string,
  centerBody: string,
  span: readonly [number, number],
  step: number,
  abcorr: AberrationCorrection = 'NONE',
): Promise<BetaAngleSeries> {
  const [et0, et1] = span;
  if (!(step > 0)) {
    throw new RangeError(`betaAngleSeries: step must be > 0 (got ${step})`);
  }
  if (!(et1 >= et0)) {
    throw new RangeError(`betaAngleSeries: span must be ascending (got [${et0}, ${et1}])`);
  }
  const n = Math.floor((et1 - et0) / step) + 1;
  const et = new Float64Array(n);
  const valueDeg = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = et0 + i * step;
    et[i] = t;
    valueDeg[i] = await betaAngle(spice, observer, centerBody, t, abcorr);
  }
  return { et, valueDeg };
}
