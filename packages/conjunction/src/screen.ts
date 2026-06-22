// All-vs-all conjunction screening. Given N objects sampled over a span, find every
// close-approach pair whose minimum separation drops below a distance threshold,
// then refine each flagged pair to a TCA / miss / Pc. A smart sieve avoids the full
// O(N^2) distance evaluation at every step: a per-object apogee/perigee band filter
// rejects pairs whose radial shells cannot overlap, and a coarse conjunction-box
// (axis-aligned bounding-box overlap over each coarse step) rejects the rest before
// any fine sampling. Pure: objects arrive as sampled ephemerides, so the package
// stays free of SPICE and propagation. (STK_PARITY_SPEC §4.8, CAT-SCR-1/CAT-TCA-1.)

import { collisionProbability2D, type Vec3 } from './index.ts';

/** A sampled inertial ephemeris for one screened object (km, km/s). */
export interface SampledEphemeris {
  /** Stable identifier (SPK id or catalog number) reported in results. */
  readonly id: string;
  /** Sample epochs (ET seconds), strictly ascending, shared length with positions. */
  readonly et: Float64Array;
  /** Interleaved positions x,y,z (km), length 3 * et.length. */
  readonly pos: Float64Array;
  /** Interleaved velocities vx,vy,vz (km/s), length 3 * et.length. */
  readonly vel: Float64Array;
  /** Hard-body radius contribution (km); summed pairwise for Pc. */
  readonly radiusKm?: number;
  /** Per-axis 1-sigma position uncertainty (km) in the inertial frame, for Pc. */
  readonly sigmaKm?: number;
}

/** A flagged close approach between two screened objects. */
export interface ConjunctionEvent {
  readonly primaryId: string;
  readonly secondaryId: string;
  /** Time of closest approach (ET seconds). */
  readonly tca: number;
  /** Miss distance at TCA (km). */
  readonly missKm: number;
  /** Relative speed at TCA (km/s). */
  readonly relSpeedKmS: number;
  /** 2D probability of collision when both objects carry radius and sigma; else null. */
  readonly pc: number | null;
}

export interface ScreenOptions {
  /** Flag pairs whose minimum separation falls below this distance (km). */
  readonly thresholdKm: number;
  /**
   * Sieve margin (km) added to the threshold for the coarse apogee/perigee and
   * conjunction-box rejection, so a pair is never dropped before fine sampling when
   * it could still close inside the threshold. Default 50 km.
   */
  readonly sieveMarginKm?: number;
  /**
   * Optional progress hook, invoked after each primary object i finishes (its pairs with all
   * higher-index objects screened), with done = i + 1 and total = objects.length - 1 (the count
   * of primaries, since the last object has no higher-index partner). Lets a worker yield progress
   * from one all-vs-all call instead of re-partitioning the catalog. Does not affect the result.
   */
  readonly onProgress?: (done: number, total: number) => void;
}

/** A screening input or configuration error (loud, located). */
export class ScreenError extends Error {
  constructor(message: string) {
    super(`conjunction screen: ${message}`);
    this.name = 'ScreenError';
  }
}

interface ObjectShells {
  /** Minimum |r| over the span (km), the effective perigee radius. */
  readonly rMin: number;
  /** Maximum |r| over the span (km), the effective apogee radius. */
  readonly rMax: number;
}

const posAt = (e: SampledEphemeris, k: number): Vec3 => ({
  x: e.pos[k * 3]!,
  y: e.pos[k * 3 + 1]!,
  z: e.pos[k * 3 + 2]!,
});

const velAt = (e: SampledEphemeris, k: number): Vec3 => ({
  x: e.vel[k * 3]!,
  y: e.vel[k * 3 + 1]!,
  z: e.vel[k * 3 + 2]!,
});

function radialShells(e: SampledEphemeris): ObjectShells {
  let rMin = Infinity;
  let rMax = 0;
  const n = e.et.length;
  for (let k = 0; k < n; k++) {
    const p = posAt(e, k);
    const r = Math.hypot(p.x, p.y, p.z);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  return { rMin, rMax };
}

/** Radial-shell (apogee/perigee band) sieve: the two shells must come within `pad`. */
function shellsOverlap(a: ObjectShells, b: ObjectShells, pad: number): boolean {
  // The closest the two spherical shells can approach is the gap between the bands;
  // if even that exceeds the padded threshold the pair can never conjunct.
  if (a.rMin > b.rMax + pad) return false;
  if (b.rMin > a.rMax + pad) return false;
  return true;
}

function validate(e: SampledEphemeris): void {
  const n = e.et.length;
  if (n < 2) throw new ScreenError(`object ${e.id} needs at least 2 samples (got ${n})`);
  if (e.pos.length !== n * 3) throw new ScreenError(`object ${e.id} pos length ${e.pos.length} != 3 * ${n}`);
  if (e.vel.length !== n * 3) throw new ScreenError(`object ${e.id} vel length ${e.vel.length} != 3 * ${n}`);
  for (let k = 1; k < n; k++) {
    if (e.et[k]! <= e.et[k - 1]!) throw new ScreenError(`object ${e.id} epochs must be strictly ascending`);
  }
}

/**
 * Every screened object must sample the SAME epoch grid: the all-vs-all sieve and refinement read
 * object b at object a's sample indices, so a mismatched grid (different length, or matching length
 * but differing epochs) would compare states at different times. Require the grids to match in
 * length and element-wise within a small absolute/relative tolerance; throw a located ScreenError
 * on the first object that diverges from the reference (the first object).
 */
function assertSharedGrid(objects: readonly SampledEphemeris[]): void {
  if (objects.length < 2) return;
  const ref = objects[0]!;
  const n = ref.et.length;
  for (let oi = 1; oi < objects.length; oi++) {
    const e = objects[oi]!;
    if (e.et.length !== n) {
      throw new ScreenError(
        `object ${e.id} has ${e.et.length} samples but object ${ref.id} has ${n}: all objects must share one screening grid`,
      );
    }
    for (let k = 0; k < n; k++) {
      const a = ref.et[k]!;
      const b = e.et[k]!;
      const tol = 1e-6 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
      if (Math.abs(a - b) > tol) {
        throw new ScreenError(
          `object ${e.id} epoch[${k}]=${b} differs from object ${ref.id} epoch[${k}]=${a}: all objects must share one screening grid`,
        );
      }
    }
  }
}

const sep = (a: SampledEphemeris, b: SampledEphemeris, k: number): number => {
  const pa = posAt(a, k);
  const pb = posAt(b, k);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
};

const relSpeedAt = (a: SampledEphemeris, b: SampledEphemeris, k: number): number => {
  const va = velAt(a, k);
  const vb = velAt(b, k);
  return Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
};

/**
 * Refine the closest approach of a flagged pair from the shared sample grid by fitting a
 * quadratic to the squared separation across the three samples bracketing the discrete
 * minimum, then taking the parabola's vertex as the sub-sample TCA. The true closest approach
 * generally falls BETWEEN samples; refining from a single endpoint and propagating with that
 * endpoint's stale relative velocity across the whole bracket mis-places the TCA and over-states
 * the miss for curved (non-rectilinear) motion. The squared-separation quadratic d2(t) = a t^2 +
 * b t + c through (t_lo, t_min, t_hi) is exact for constant-acceleration relative motion and a
 * good local model otherwise; its vertex t* = -b/(2a) lands the TCA between samples, and the miss
 * is the quadratic minimum sqrt(d2(t*)). The miss is never reported worse than the discrete grid
 * minimum.
 */
function refinePair(a: SampledEphemeris, b: SampledEphemeris): ConjunctionEvent {
  const n = a.et.length;
  let kMin = 0;
  let dMin = Infinity;
  for (let k = 0; k < n; k++) {
    const d = sep(a, b, k);
    if (d < dMin) {
      dMin = d;
      kMin = k;
    }
  }
  const kLo = kMin === 0 ? 0 : kMin - 1;
  const kHi = kMin === n - 1 ? n - 1 : kMin + 1;
  const tLo = a.et[kLo]!;
  const tMin = a.et[kMin]!;
  const tHi = a.et[kHi]!;

  let tca = tMin;
  let missKm = dMin;
  // Fit only when kMin is interior with a real bracket on both sides; an edge minimum has no
  // bracket so the discrete sample is the best available estimate.
  if (kLo < kMin && kMin < kHi) {
    // Squared separations at the three bracket samples, parameterized by time offset from tMin.
    const xLo = tLo - tMin;
    const xHi = tHi - tMin;
    const yLo = sep(a, b, kLo) ** 2;
    const yMin = dMin * dMin;
    const yHi = sep(a, b, kHi) ** 2;
    // Lagrange-fit d2(x) = A x^2 + B x + C through (xLo,yLo),(0,yMin),(xHi,yHi). Vertex at -B/2A.
    const denom = xLo * xHi * (xLo - xHi);
    if (denom !== 0) {
      const A = (xHi * (yLo - yMin) - xLo * (yHi - yMin)) / denom;
      const B = (xLo * xLo * (yHi - yMin) - xHi * xHi * (yLo - yMin)) / denom;
      if (A > 0) {
        // Upward parabola: its vertex is the minimum. Clamp into the bracket [xLo, xHi].
        const xStar = Math.max(xLo, Math.min(xHi, -B / (2 * A)));
        const d2Star = A * xStar * xStar + B * xStar + yMin;
        tca = tMin + xStar;
        missKm = Math.min(dMin, Math.sqrt(Math.max(0, d2Star)));
      }
    }
  }

  // Relative speed near TCA: the change in separation is second order at the minimum, so the
  // sampled relative speed at the bracketed minimum sample is the representative encounter speed.
  const relSpeedKmS = relSpeedAt(a, b, kMin);

  let pc: number | null = null;
  if (a.radiusKm !== undefined && b.radiusKm !== undefined && a.sigmaKm !== undefined && b.sigmaKm !== undefined) {
    const sigma = Math.hypot(a.sigmaKm, b.sigmaKm);
    pc = collisionProbability2D({
      radiusKm: a.radiusKm + b.radiusKm,
      sigmaXKm: sigma,
      sigmaYKm: sigma,
      // With an isotropic combined covariance the full miss magnitude is the offset
      // projected into the encounter plane.
      missXKm: missKm,
      missYKm: 0,
    });
  }
  return { primaryId: a.id, secondaryId: b.id, tca, missKm, relSpeedKmS, pc };
}

/**
 * All-vs-all screen: flag every pair that closes below `thresholdKm` over the span
 * and report each pair's TCA, miss, relative speed, and (when covariance is given)
 * Pc. The two-stage sieve (radial-shell band, then coarse bounding-box overlap)
 * rejects non-conjuncting pairs before any fine evaluation.
 */
export function screenAllVsAll(objects: readonly SampledEphemeris[], opts: ScreenOptions): ConjunctionEvent[] {
  if (opts.thresholdKm <= 0) throw new ScreenError(`thresholdKm must be positive (got ${opts.thresholdKm})`);
  for (const e of objects) validate(e);
  // The sieve and the pair refinement index object b at object a's sample indices (they "share the
  // screening grid"). validate() only checks each object's own monotonicity and length, so a
  // mismatched grid (different length, or the same length but different epochs) would index into a
  // different time for b and silently yield a dropped or bogus conjunction. Assert a common et grid
  // across all objects (length AND element-wise within tolerance) and fail loudly otherwise.
  assertSharedGrid(objects);
  const pad = (opts.sieveMarginKm ?? 50) + opts.thresholdKm;
  const shells = objects.map(radialShells);

  const events: ConjunctionEvent[] = [];
  const total = objects.length - 1; // primaries 0..N-2 (the last object has no higher-index pair)
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i]!;
      const b = objects[j]!;
      // Stage 1: radial-shell apogee/perigee band sieve.
      if (!shellsOverlap(shells[i]!, shells[j]!, pad)) continue;
      // Stage 2: coarse conjunction-box: any sample where the per-axis separation is
      // within the padded threshold. (Objects share the screening grid.)
      if (!boxesEverOverlap(a, b, pad)) continue;
      // Fine: refine to TCA / miss / Pc, and keep only sub-threshold approaches.
      const ev = refinePair(a, b);
      if (ev.missKm <= opts.thresholdKm) events.push(ev);
    }
    // Report after primary i finishes (all its higher-index pairs screened). i < total covers
    // every primary; the last object (i === total) has no pair, so it is not reported.
    if (i < total) opts.onProgress?.(i + 1, total);
  }
  events.sort((p, q) => p.tca - q.tca);
  return events;
}

/** Coarse box sieve: true if any shared sample brings every axis within `pad`. */
function boxesEverOverlap(a: SampledEphemeris, b: SampledEphemeris, pad: number): boolean {
  const n = a.et.length;
  for (let k = 0; k < n; k++) {
    const pa = posAt(a, k);
    const pb = posAt(b, k);
    if (Math.abs(pb.x - pa.x) <= pad && Math.abs(pb.y - pa.y) <= pad && Math.abs(pb.z - pa.z) <= pad) {
      return true;
    }
  }
  return false;
}
