// @bessel/analysis: the Analysis Workbench primitives. The Vector Geometry Tool
// (angles, projections, planes) and a typed time-series sampler over data
// providers. Pure; geometry providers are supplied by callers (which read SPICE).
// The charting/report UI consumes the Series. (STK_PARITY_SPEC §4.10.)

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
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/** Unsigned angle between two vectors (rad), numerically robust near 0 and pi. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(mag(cross(a, b)), dot(a, b));
}

/** Signed angle (rad) from a to b measured about `axis` (right-handed). */
export function signedAngleAbout(a: Vec3, b: Vec3, axis: Vec3): number {
  const s = dot(cross(a, b), axis);
  return Math.atan2(s, dot(a, b) * mag(axis));
}

/** Scalar projection of v onto axis (component along axis). */
export function projection(v: Vec3, axis: Vec3): number {
  const m = mag(axis);
  return m > 0 ? dot(v, axis) / m : 0;
}

/** Component of v perpendicular to axis. */
export function rejection(v: Vec3, axis: Vec3): Vec3 {
  const m2 = dot(axis, axis);
  return m2 > 0 ? sub(v, scale(axis, dot(v, axis) / m2)) : v;
}

/** Elevation of v above the plane with the given normal (rad; +/- pi/2). */
export function vectorToPlaneAngle(v: Vec3, planeNormal: Vec3): number {
  const mv = mag(v);
  const mn = mag(planeNormal);
  if (mv === 0 || mn === 0) return 0;
  return Math.asin(Math.max(-1, Math.min(1, dot(v, planeNormal) / (mv * mn))));
}

/** A named scalar quantity sampled over epochs (a Report/Graph data provider). */
export type DataProvider = (et: number) => number;

export interface Series {
  readonly providerId: string;
  readonly et: Float64Array;
  readonly value: Float64Array;
}

/** Sample a provider over an epoch grid into an immutable Series. */
export function sampleSeries(providerId: string, provider: DataProvider, etGrid: Float64Array): Series {
  const value = new Float64Array(etGrid.length);
  for (let k = 0; k < etGrid.length; k++) value[k] = provider(etGrid[k]!);
  return { providerId, et: Float64Array.from(etGrid), value };
}

/** Min / max / mean reduction of a sampled series (a basic report statistic). */
export function seriesStats(series: Series): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of series.value) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const n = series.value.length;
  return { min, max, mean: n ? sum / n : 0 };
}
