// Full (non-axis-aligned) encounter-plane probability of collision, plus the
// encounter-plane (B-plane) construction and 3x3 -> 2x2 covariance projection.
// Foster's method generalized to a cross-correlated 2x2 covariance via the
// Mahalanobis form of the bivariate Gaussian, integrated over the hard-body disk
// by polar quadrature (the same midpoint scheme as collisionProbability2D).
// Pure math. (STK_PARITY_SPEC §4.8.)

import type { Vec3 } from './index.ts';

/** A covariance/input error in the encounter-plane Pc math (loud, located). */
export class CovarianceError extends Error {
  constructor(message: string) {
    super(`conjunction covariance: ${message}`);
    this.name = 'CovarianceError';
  }
}

/**
 * A symmetric 2x2 covariance in the encounter plane (km^2). Layout: cxx and cyy
 * are the diagonal variances, cxy is the single off-diagonal (cyx == cxy).
 */
export interface Cov2x2 {
  readonly cxx: number;
  readonly cxy: number;
  readonly cyy: number;
}

/**
 * An orthonormal encounter-plane (B-plane) frame. `u` and `v` are unit vectors
 * spanning the plane normal to the relative velocity; `n` is the relative-velocity
 * unit normal. The triad (u, v, n) is right-handed and orthonormal.
 */
export interface EncounterFrame {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

export interface PcCovInput {
  /** Combined hard-body radius (km): sum of the two objects' radii. */
  readonly radiusKm: number;
  /** Nominal miss vector projected into the encounter plane (km). */
  readonly missXKm: number;
  readonly missYKm: number;
  /** Full 2x2 encounter-plane position covariance (km^2). */
  readonly cov: Cov2x2;
}

/**
 * Integrate the bivariate Gaussian with a full (cross-correlated) 2x2 covariance,
 * centered at the miss vector, over the combined hard-body disk of radius
 * `radiusKm`, via midpoint polar quadrature. The integrand is the Mahalanobis form
 *   g(d) = exp(-0.5 d^T Cinv d) / (2 pi sqrt(det C)),  d = disk-point - miss,
 * which reduces to the axis-aligned integrand when cxy = 0. Throws on a covariance
 * that is not symmetric-positive-definite (det <= 0 or a non-positive variance).
 */
export function collisionProbabilityCov(input: PcCovInput, samples = 240): number {
  const { radiusKm: R, missXKm: mx, missYKm: my, cov } = input;
  if (!Number.isFinite(R)) throw new CovarianceError(`radiusKm must be finite (got ${R})`);
  if (R <= 0) return 0;
  const { cxx, cxy, cyy } = cov;
  if (![cxx, cxy, cyy, mx, my].every(Number.isFinite)) {
    throw new CovarianceError('covariance and miss entries must be finite');
  }
  // Symmetric positive-definite check (Sylvester): leading minors must be positive.
  const det = cxx * cyy - cxy * cxy;
  if (cxx <= 0 || cyy <= 0 || det <= 0) {
    throw new CovarianceError(
      `covariance must be positive-definite (cxx=${cxx}, cyy=${cyy}, det=${det})`,
    );
  }
  // Inverse of the symmetric 2x2: Cinv = (1/det) [[cyy, -cxy], [-cxy, cxx]].
  const iXX = cyy / det;
  const iXY = -cxy / det;
  const iYY = cxx / det;
  const norm = 1 / (2 * Math.PI * Math.sqrt(det));

  const nr = samples;
  const nt = samples;
  const dr = R / nr;
  const dt = (2 * Math.PI) / nt;
  let pc = 0;
  for (let ir = 0; ir < nr; ir++) {
    const r = (ir + 0.5) * dr; // midpoint radius
    for (let it = 0; it < nt; it++) {
      const th = (it + 0.5) * dt;
      const dx = r * Math.cos(th) - mx;
      const dy = r * Math.sin(th) - my;
      // Mahalanobis quadratic d^T Cinv d for the symmetric inverse.
      const q = iXX * dx * dx + 2 * iXY * dx * dy + iYY * dy * dy;
      pc += norm * Math.exp(-0.5 * q) * r * dr * dt; // polar area element r dr dtheta
    }
  }
  return Math.min(1, pc);
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

/**
 * Build an orthonormal encounter-plane frame from the relative velocity of the
 * chaser with respect to the target. The encounter plane is normal to the relative
 * velocity; `u` and `v` span it, `n` is the relative-velocity unit. A reference axis
 * least parallel to `n` seeds `u` so the construction is numerically stable for any
 * `n`. Throws on a zero (or non-finite) relative velocity.
 */
export function encounterPlane(relVelChaserToTarget: Vec3): EncounterFrame {
  const rv = relVelChaserToTarget;
  if (![rv.x, rv.y, rv.z].every(Number.isFinite)) {
    throw new CovarianceError('relative velocity must be finite');
  }
  const speed = norm3(rv);
  if (speed <= 0) {
    throw new CovarianceError('relative velocity must be non-zero to define an encounter plane');
  }
  const n = scale(rv, 1 / speed);
  // Seed with whichever world axis is least aligned with n (smallest |component|).
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let seed: Vec3;
  if (ax <= ay && ax <= az) seed = { x: 1, y: 0, z: 0 };
  else if (ay <= az) seed = { x: 0, y: 1, z: 0 };
  else seed = { x: 0, y: 0, z: 1 };
  // u = normalize(seed - (seed.n) n); v = n x u. (u, v, n) is right-handed orthonormal.
  const sn = seed.x * n.x + seed.y * n.y + seed.z * n.z;
  const uRaw: Vec3 = { x: seed.x - sn * n.x, y: seed.y - sn * n.y, z: seed.z - sn * n.z };
  const u = scale(uRaw, 1 / norm3(uRaw));
  const v = cross(n, u);
  return { u, v, n };
}

/**
 * Project a 3x3 relative-position covariance (km^2, row-major length 9) into the
 * 2x2 in-plane covariance of an encounter frame: C2 = P^T C3 P, where P = [u v] is
 * the 3x2 matrix whose columns are the in-plane basis vectors. The off-diagonal
 * cross-correlation cxy survives the projection in general. Throws on a malformed
 * (non-length-9, non-finite, or non-symmetric) 3x3 covariance.
 */
export function projectCovarianceToEncounterPlane(
  cov3x3: ArrayLike<number>,
  frame: EncounterFrame,
): Cov2x2 {
  if (cov3x3.length !== 9) {
    throw new CovarianceError(`3x3 covariance must have length 9 (got ${cov3x3.length})`);
  }
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(cov3x3[i]!)) throw new CovarianceError(`3x3 covariance entry ${i} is not finite`);
  }
  const c = (r: number, col: number): number => cov3x3[r * 3 + col]!;
  // Symmetry check (the projection assumes a symmetric covariance).
  const symTol = 1e-9 * (1 + Math.abs(c(0, 0)) + Math.abs(c(1, 1)) + Math.abs(c(2, 2)));
  if (
    Math.abs(c(0, 1) - c(1, 0)) > symTol ||
    Math.abs(c(0, 2) - c(2, 0)) > symTol ||
    Math.abs(c(1, 2) - c(2, 1)) > symTol
  ) {
    throw new CovarianceError('3x3 covariance must be symmetric');
  }
  const { u, v } = frame;
  // C3 * w for a column vector w.
  const cw = (w: Vec3): Vec3 => ({
    x: c(0, 0) * w.x + c(0, 1) * w.y + c(0, 2) * w.z,
    y: c(1, 0) * w.x + c(1, 1) * w.y + c(1, 2) * w.z,
    z: c(2, 0) * w.x + c(2, 1) * w.y + c(2, 2) * w.z,
  });
  const dotv = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const cu = cw(u);
  const cv = cw(v);
  return {
    cxx: dotv(u, cu),
    cxy: dotv(u, cv),
    cyy: dotv(v, cv),
  };
}
