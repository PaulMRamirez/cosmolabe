// Full NxN spherical-harmonic gravity (zonal + sectoral + tesseral), the longitude-
// dependent generalization of zonal.ts. The acceleration is the gradient of the
// geopotential
//   U = (gm/r) * sum_{n,m} (Re/r)^n Pbar_{n,m}(sin phi) [Cbar_{n,m} cos(m lambda)
//                                                        + Sbar_{n,m} sin(m lambda)]
// evaluated in the body-fixed frame with the Cunningham/Gottlieb V/W recurrence on the
// UNNORMALIZED coefficients, then rotated into the inertial frame by a supplied
// synchronous body-fixed -> inertial rotation. Normalized Cbar/Sbar are de-normalized
// once at build time. SPICE pxform is resolved up front into a sync closure (mirroring
// third-body.ts positionAt), so the integrator's inner loop never awaits. No analytic
// partials: the model's finite-difference fallback covers da/dr. Keep zonal.ts as-is.
// References: Montenbruck & Gill, "Satellite Orbits", section 3.2.4 (Cunningham
// recursion); Vallado, "Fundamentals of Astrodynamics and Applications", section 8.6.
// (STK_PARITY_SPEC section 4.2.)

import { IntegrationError } from '../errors.ts';
import type { ForceContext, ForceTerm, Mat3, Vector3 } from './types.ts';

/** A synchronous body-fixed -> inertial rotation (row-major 3x3) at an epoch. */
export type RotationAt = (et: number) => Mat3;

export interface SphericalHarmonicsBody {
  /** Gravitational parameter (km^3/s^2). */
  readonly gm: number;
  /** Reference (equatorial) radius (km), the Re the coefficients are referred to. */
  readonly re: number;
}

export interface SphericalHarmonicsOptions {
  readonly body: SphericalHarmonicsBody;
  /**
   * Normalized cosine coefficients Cbar[n][m], n in [0..N], m in [0..n] (a ragged
   * lower triangle). C[0][0] is the monopole and is ignored here (point-mass term).
   */
  readonly cbar: readonly (readonly number[])[];
  /** Normalized sine coefficients Sbar[n][m], same shape as `cbar`. */
  readonly sbar: readonly (readonly number[])[];
  /** Maximum degree to evaluate (default: the size of `cbar` minus one). */
  readonly degree?: number;
  /** Maximum order to evaluate (default: equal to `degree`). */
  readonly order?: number;
  /** Body-fixed -> inertial rotation at an epoch (resolve a SPICE pxform up front). */
  readonly rotation: RotationAt;
}

/** The full geopotential was misconfigured (ragged coefficients, degree out of range). */
export class SphericalHarmonicsError extends IntegrationError {
  constructor(message: string) {
    super(`spherical-harmonics: ${message}`);
    this.name = 'SphericalHarmonicsError';
  }
}

/**
 * Kaula normalization factor that converts a normalized coefficient Cbar_{n,m} to its
 * unnormalized form: C_{n,m} = N_{n,m} Cbar_{n,m}, with
 *   N_{n,m} = sqrt( (n-m)! (2n+1) (2 - delta_{0m}) / (n+m)! ).
 * Computed via a running ratio to stay finite for large (n,m).
 */
function denormFactor(n: number, m: number): number {
  const k = m === 0 ? 1 : 2;
  let f = (2 * n + 1) * k;
  // f *= (n-m)! / (n+m)! = product_{j=n-m+1}^{n+m} 1/j
  for (let j = n - m + 1; j <= n + m; j++) f /= j;
  return Math.sqrt(f);
}

/** Build the unnormalized lower-triangular C/S arrays from the normalized inputs. */
function deNormalize(
  cbar: readonly (readonly number[])[],
  sbar: readonly (readonly number[])[],
  nmax: number,
  mmax: number,
): { c: number[][]; s: number[][] } {
  const c: number[][] = [];
  const s: number[][] = [];
  for (let n = 0; n <= nmax; n++) {
    const cRow = new Array<number>(n + 1).fill(0);
    const sRow = new Array<number>(n + 1).fill(0);
    const cb = cbar[n];
    const sb = sbar[n];
    const top = Math.min(n, mmax);
    for (let m = 0; m <= top; m++) {
      const f = denormFactor(n, m);
      cRow[m] = (cb && cb[m] !== undefined ? cb[m]! : 0) * f;
      sRow[m] = (sb && sb[m] !== undefined ? sb[m]! : 0) * f;
    }
    c.push(cRow);
    s.push(sRow);
  }
  return { c, s };
}

/**
 * A full spherical-harmonic gravity term. The acceleration is evaluated in the body-
 * fixed frame via the Cunningham V/W recursion and rotated to inertial by `rotation`.
 * Provides no analytic partials(); the force model finite-differences da/dr.
 */
export function sphericalHarmonics(opts: SphericalHarmonicsOptions): ForceTerm {
  const { gm, re } = opts.body;
  const available = opts.cbar.length - 1;
  const nmax = opts.degree ?? available;
  const mmax = opts.order ?? nmax;
  if (nmax < 1) throw new SphericalHarmonicsError(`degree must be >= 1 (got ${nmax})`);
  if (nmax > available) throw new SphericalHarmonicsError(`degree ${nmax} exceeds supplied coefficients (max ${available})`);
  if (mmax > nmax) throw new SphericalHarmonicsError(`order ${mmax} exceeds degree ${nmax}`);
  if (opts.sbar.length - 1 < available) throw new SphericalHarmonicsError('cbar and sbar must have matching degree');

  const { c, s } = deNormalize(opts.cbar, opts.sbar, nmax, mmax);
  const rotation = opts.rotation;
  // V/W run to degree nmax+1 so the partial-derivative recurrence (which reaches n+1)
  // stays in range.
  const dim = nmax + 2;

  return {
    name: 'sphericalHarmonics',
    acceleration(ctx: ForceContext): Vector3 {
      const rot = rotation(ctx.et);
      // Inertial -> body-fixed is the transpose of the body-fixed -> inertial rotation.
      const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rot;
      const [ix, iy, iz] = ctx.r;
      const x = r00 * ix + r10 * iy + r20 * iz;
      const y = r01 * ix + r11 * iy + r21 * iz;
      const z = r02 * ix + r12 * iy + r22 * iz;

      const r2 = x * x + y * y + z * z;
      const rmag = Math.sqrt(r2);
      const reR = re / r2; // Re / r^2, the V/W recurrence scale
      const reOverR = re / rmag;

      // Cunningham V_{n,m}, W_{n,m} (Montenbruck & Gill eq. 3.29-3.30), indexed [n][m].
      const idx = (n: number, m: number): number => n * dim + m;
      const V = new Float64Array(dim * dim);
      const W = new Float64Array(dim * dim);
      V[idx(0, 0)] = reOverR; // (Re/r); W_{0,0} = 0
      // Zonal column (m = 0) via the vertical recurrence.
      for (let n = 1; n < dim; n++) {
        if (n === 1) {
          V[idx(1, 0)] = z * reR * V[idx(0, 0)]!;
        } else {
          V[idx(n, 0)] = ((2 * n - 1) * z * reR * V[idx(n - 1, 0)]! - (n - 1) * (re * reR) * V[idx(n - 2, 0)]!) / n;
        }
      }
      // Sectoral (m = n) then tesseral (m < n) via the diagonal and vertical recurrences.
      for (let m = 1; m < dim; m++) {
        // Sectoral: V_{m,m}, W_{m,m} from V_{m-1,m-1}, W_{m-1,m-1}.
        const vmm = V[idx(m - 1, m - 1)]!;
        const wmm = W[idx(m - 1, m - 1)]!;
        V[idx(m, m)] = (2 * m - 1) * (x * reR * vmm - y * reR * wmm);
        W[idx(m, m)] = (2 * m - 1) * (x * reR * wmm + y * reR * vmm);
        // Tesseral: vertical recurrence up the column at fixed order m.
        for (let n = m + 1; n < dim; n++) {
          const a1 = ((2 * n - 1) * z * reR) / (n - m);
          V[idx(n, m)] = a1 * V[idx(n - 1, m)]!;
          W[idx(n, m)] = a1 * W[idx(n - 1, m)]!;
          if (n - 2 >= m) {
            const a2 = ((n + m - 1) * (re * reR)) / (n - m);
            V[idx(n, m)]! -= a2 * V[idx(n - 2, m)]!;
            W[idx(n, m)]! -= a2 * W[idx(n - 2, m)]!;
          }
        }
      }

      // Acceleration in the body-fixed frame (Montenbruck & Gill eq. 3.33), gm/Re^2 scaled.
      const k = gm / (re * re);
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let n = 1; n <= nmax; n++) {
        const top = Math.min(n, mmax);
        for (let m = 0; m <= top; m++) {
          const Cnm = c[n]![m]!;
          const Snm = s[n]![m]!;
          if (Cnm === 0 && Snm === 0) continue;
          if (m === 0) {
            ax += -Cnm * V[idx(n + 1, 1)]!;
            ay += -Cnm * W[idx(n + 1, 1)]!;
          } else {
            const f = 0.5 * (n - m + 1) * (n - m + 2);
            ax += 0.5 * (-Cnm * V[idx(n + 1, m + 1)]! - Snm * W[idx(n + 1, m + 1)]!) + f * (Cnm * V[idx(n + 1, m - 1)]! + Snm * W[idx(n + 1, m - 1)]!);
            ay += 0.5 * (-Cnm * W[idx(n + 1, m + 1)]! + Snm * V[idx(n + 1, m + 1)]!) + f * (-Cnm * W[idx(n + 1, m - 1)]! + Snm * V[idx(n + 1, m - 1)]!);
          }
          az += (n - m + 1) * (-Cnm * V[idx(n + 1, m)]! - Snm * W[idx(n + 1, m)]!);
        }
      }
      ax *= k;
      ay *= k;
      az *= k;

      // Rotate the body-fixed acceleration back to the inertial frame.
      return [
        r00 * ax + r01 * ay + r02 * az,
        r10 * ax + r11 * ay + r12 * az,
        r20 * ax + r21 * ay + r22 * az,
      ];
    },
  };
}

/**
 * Resolve a fixed (epoch-independent) rotation into a RotationAt closure, e.g. when the
 * body-fixed frame is treated as inertially aligned over a short arc, or for tests.
 */
export function fixedRotation(rot: Mat3): RotationAt {
  return () => rot;
}
