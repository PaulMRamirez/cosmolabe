// Zonal spherical-harmonic gravity (J2, J3, J4): the acceleration is the gradient of
// the zonal potential U = -(mu/r) * sum_{n>=2} J_n (Re/r)^n P_n(z/r), evaluated with
// Legendre polynomials and their derivatives by stable recursion (one verified
// algorithm for every n, the scalable seam toward NxN). J_n are unnormalized,
// caller-supplied (a PCK carries no harmonics). Frame note: evaluated directly in
// J2000; for Earth the pole is within ~0.006 rad of +Z, a documented small-
// misalignment approximation. NxN tesserals will require the body-fixed rotation via
// ForceContext.et. The J2 term and its sign are pinned by secularRatesJ2.
// (STK_PARITY_SPEC §4.2.)

import type { ForceContext, ForceTerm, Vector3 } from './types.ts';

export interface ZonalBody {
  /** Gravitational parameter (km^3/s^2). */
  readonly gm: number;
  /** Reference (equatorial) radius (km), consistent with the J_n reference radius. */
  readonly re: number;
}

export interface ZonalCoeffs {
  readonly j2: number;
  readonly j3?: number;
  readonly j4?: number;
}

/**
 * A zonal-harmonics force term for the given unnormalized J_n. Contributes the J2,
 * J3, and J4 acceleration (those with a nonzero coefficient).
 */
export function zonalHarmonics(body: ZonalBody, coeffs: ZonalCoeffs): ForceTerm {
  // J_n indexed by degree n (j[2], j[3], j[4]); n=0,1 unused.
  const j: number[] = [0, 0, coeffs.j2, coeffs.j3 ?? 0, coeffs.j4 ?? 0];
  let maxN = 2;
  for (let n = 2; n < j.length; n++) if (j[n] !== 0) maxN = n;
  const { gm, re } = body;

  return {
    name: 'zonal',
    acceleration(ctx: ForceContext): Vector3 {
      const [x, y, z] = ctx.r;
      const r = Math.sqrt(x * x + y * y + z * z);
      const u = z / r; // sin(latitude)

      // Legendre polynomials P_n(u) and derivatives P_n'(u) by recursion (no division
      // by (1-u^2), so the poles are safe): P_n' = u P_{n-1}' + n P_{n-1}.
      const P = new Array<number>(maxN + 1);
      const Pp = new Array<number>(maxN + 1);
      P[0] = 1;
      Pp[0] = 0;
      if (maxN >= 1) {
        P[1] = u;
        Pp[1] = 1;
      }
      for (let n = 2; n <= maxN; n++) {
        P[n] = ((2 * n - 1) * u * P[n - 1]! - (n - 1) * P[n - 2]!) / n;
        Pp[n] = u * Pp[n - 1]! + n * P[n - 1]!;
      }

      let ax = 0;
      let ay = 0;
      let az = 0;
      let rePow = re * re; // Re^n starting at n=2
      for (let n = 2; n <= maxN; n++) {
        if (n > 2) rePow *= re;
        const Jn = j[n]!;
        if (Jn !== 0) {
          const coeff = gm * Jn * rePow;
          // common_xy = gm J_n Re^n r^-(n+3) (u P_n' + (n+1) P_n)
          const commonXy = (coeff / r ** (n + 3)) * (u * Pp[n]! + (n + 1) * P[n]!);
          ax += commonXy * x;
          ay += commonXy * y;
          // a_z = -gm J_n Re^n r^-(n+2) ((1-u^2) P_n' - (n+1) u P_n)
          az += -(coeff / r ** (n + 2)) * ((1 - u * u) * Pp[n]! - (n + 1) * u * P[n]!);
        }
      }
      return [ax, ay, az];
    },
  };
}
