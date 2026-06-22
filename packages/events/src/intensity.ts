// @bessel/events: solar intensity (penumbra fraction). Pure geometry on top of
// spkpos/bodvrd (no new SPICE bindings). Models the Sun and the occulting body as
// spheres of their mean radii and computes the visible fraction of the Sun's disk
// from the observer via the analytic two-circle lens-overlap area. Core layer:
// depends only on @bessel/spice. (Phase B.)

import type { AberrationCorrection, SpiceEngine, Vec3 } from '@bessel/spice';

/** Below this a position vector is treated as degenerate (km). */
const MIN_RANGE = 1e-9;

/** Raised when an intensity sample cannot be evaluated (degenerate geometry/radii). */
export class IntensityGeometryError extends Error {
  constructor(
    message: string,
    readonly observer: string,
    readonly body: string,
    readonly et: number,
  ) {
    super(message);
    this.name = 'IntensityGeometryError';
  }
}

/** Options for {@link solarIntensity}: aberration and an override light source. */
export interface SolarIntensityOptions {
  readonly abcorr?: AberrationCorrection;
  /** The illuminating body; defaults to the Sun. */
  readonly light?: string;
}

/** A solar-intensity time series: parallel epoch and visible-fraction columns. */
export interface SolarIntensitySeries {
  readonly et: Float64Array;
  /** Visible fraction of the Sun's disk in [0, 1]. */
  readonly fraction: Float64Array;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const norm = (a: Vec3): number => Math.sqrt(dot(a, a));

const clampUnit = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);

const clamp01 = (v: number): number => (v > 1 ? 1 : v < 0 ? 0 : v);

/**
 * Area of the overlap (lens) of two circles of radii rA and rB whose centers are a
 * distance d apart. All inputs are angular radii (radians) here, but the formula is
 * dimensionally generic.
 *
 * Branches: disjoint (d >= rA + rB) -> 0; one inside the other (d <= |rA - rB|) ->
 * pi * min(rA, rB)^2; otherwise the classic two-circle lens area.
 */
export function overlapArea(rA: number, rB: number, d: number): number {
  if (rA <= 0 || rB <= 0) return 0;
  if (d >= rA + rB) return 0;
  if (d <= Math.abs(rA - rB)) {
    const rMin = Math.min(rA, rB);
    return Math.PI * rMin * rMin;
  }
  const rA2 = rA * rA;
  const rB2 = rB * rB;
  const d2 = d * d;
  const alpha = Math.acos(clampUnit((d2 + rA2 - rB2) / (2 * d * rA)));
  const beta = Math.acos(clampUnit((d2 + rB2 - rA2) / (2 * d * rB)));
  const triA = rA2 * (alpha - Math.sin(alpha) * Math.cos(alpha));
  const triB = rB2 * (beta - Math.sin(beta) * Math.cos(beta));
  return triA + triB;
}

/**
 * Visible fraction of the Sun's disk in [0, 1], given the apparent angular radii of
 * the Sun (rS) and occulting body (rB) and their angular separation d (all radians).
 *
 * fraction = 1 - overlapArea(rS, rB, d) / (pi * rS^2), clamped to [0, 1]. The annular
 * branch (body fully inside the Sun's disk) and the total branch (Sun fully behind
 * the body) fall out of overlapArea, but are written explicitly for clarity.
 */
export function visibleFraction(rS: number, rB: number, d: number): number {
  if (rS <= 0) return 1;
  // Total: Sun fully behind the body (body covers the Sun's disk).
  if (d <= rB - rS) return 0;
  // Annular: body fully inside the Sun's disk.
  if (d <= rS - rB) return clamp01(1 - (rB * rB) / (rS * rS));
  // Disjoint: no occultation.
  if (d >= rS + rB) return 1;
  return clamp01(1 - overlapArea(rS, rB, d) / (Math.PI * rS * rS));
}

/** Mean radius (km) of a body from its bodvrd RADII triaxial values. */
async function meanRadiusKm(spice: SpiceEngine, body: string): Promise<number> {
  const radii = await spice.bodvrd(body, 'RADII');
  if (radii.length < 3) {
    throw new IntensityGeometryError(
      `solarIntensity: bodvrd ${body} RADII returned ${radii.length} values (expected 3)`,
      body,
      body,
      Number.NaN,
    );
  }
  return (radii[0]! + radii[1]! + radii[2]!) / 3;
}

/**
 * Visible fraction of the Sun's disk from `observer` at `et`, occulted by `body`.
 * Sun and body are modeled as spheres of their mean radii (bodvrd RADII). `bodyFrame`
 * is accepted for API symmetry with eclipseIntervals; the spherical model is
 * frame-independent, so it does not affect the result.
 */
export async function solarIntensity(
  spice: SpiceEngine,
  observer: string,
  body: string,
  bodyFrame: string,
  et: number,
  opts: SolarIntensityOptions = {},
): Promise<number> {
  // bodyFrame is accepted for API symmetry with eclipseIntervals; the spherical
  // model is frame-independent, so it is intentionally not consumed here.
  void bodyFrame;
  const abcorr = opts.abcorr ?? 'NONE';
  const light = opts.light ?? 'SUN';
  const sunPos = (await spice.spkpos(light, et, 'J2000', abcorr, observer)).position;
  const bodyPos = (await spice.spkpos(body, et, 'J2000', abcorr, observer)).position;
  const sunRange = norm(sunPos);
  const bodyRange = norm(bodyPos);
  if (sunRange < MIN_RANGE || bodyRange < MIN_RANGE) {
    throw new IntensityGeometryError(
      `solarIntensity: degenerate range from ${observer} at et=${et}; |sun|=${sunRange}, |body|=${bodyRange}`,
      observer,
      body,
      et,
    );
  }
  const sunRadius = await meanRadiusKm(spice, light);
  const bodyRadius = await meanRadiusKm(spice, body);
  // Apparent angular radii (small-angle-safe via asin) and angular separation.
  const rS = Math.asin(clampUnit(sunRadius / sunRange));
  const rB = Math.asin(clampUnit(bodyRadius / bodyRange));
  const cosSep = clampUnit(dot(sunPos, bodyPos) / (sunRange * bodyRange));
  const d = Math.acos(cosSep);
  return visibleFraction(rS, rB, d);
}

/**
 * Sample {@link solarIntensity} over [et0, et1] at the given step (s). `step` must be
 * positive and the span ascending.
 */
export async function solarIntensitySeries(
  spice: SpiceEngine,
  observer: string,
  body: string,
  bodyFrame: string,
  span: readonly [number, number],
  step: number,
  opts: SolarIntensityOptions = {},
): Promise<SolarIntensitySeries> {
  const [et0, et1] = span;
  if (!(step > 0)) {
    throw new RangeError(`solarIntensitySeries: step must be > 0 (got ${step})`);
  }
  if (!(et1 >= et0)) {
    throw new RangeError(`solarIntensitySeries: span must be ascending (got [${et0}, ${et1}])`);
  }
  const n = Math.floor((et1 - et0) / step) + 1;
  const et = new Float64Array(n);
  const fraction = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = et0 + i * step;
    et[i] = t;
    fraction[i] = await solarIntensity(spice, observer, body, bodyFrame, t, opts);
  }
  return { et, fraction };
}
