// Harris-Priester atmospheric density: a higher-fidelity drop-in for the exponential
// model, behind the same DensityModel seam (force/drag.ts). It models the diurnal
// density bulge that the exponential band table cannot: density at a point is
// interpolated between a "minimum" (antapex, cold/night) and "maximum" (apex, warm/
// day) density profile, weighted by the cosine of half the angle between the point
// and the diurnal bulge (which lags the sub-solar point by ~30 deg in longitude).
//
// This is NOT the full NRLMSISE-00 (which needs F10.7/Ap space-weather drivers and a
// species-resolved thermosphere); it is the standard Harris-Priester model used in
// Montenbruck & Gill ("Satellite Orbits", section 3.5, eqs. 3.90-3.93) with their
// tabulated 100-1000 km min/max densities for moderate solar activity (mean F10.7).
// Density is C0-continuous in altitude (log-linear interpolation within each band)
// and in position (the cos^n bulge weighting is continuous). It returns kg/km^3, the
// unit drag expects. (STK_PARITY_SPEC section 4.1 PROP-9, section 9 row "Propagation".)

import { DragError, type DensityModel } from './drag.ts';
import type { Vector3 } from './types.ts';

/** One Harris-Priester altitude row: min (night) and max (day) density at height h. */
export interface HarrisPriesterRow {
  /** Geometric altitude above the equatorial radius (km). */
  readonly h: number;
  /** Minimum (antapex/night-side) density (g/km^3). */
  readonly rhoMin: number;
  /** Maximum (apex/day-side) density (g/km^3). */
  readonly rhoMax: number;
}

// Montenbruck & Gill, Table 3.8: Harris-Priester density coefficients for mean solar
// activity (n = 2 exponent below; the table is for the standard nighttime/daytime
// bulge). Altitude (km), rho_min and rho_max in g/km^3 (= 1e-3 kg/km^3). Abridged to
// the rows that matter for LEO drag (100-1000 km).
const HP_MEAN: readonly HarrisPriesterRow[] = [
  { h: 100, rhoMin: 4.974e5, rhoMax: 4.974e5 },
  { h: 120, rhoMin: 2.49e4, rhoMax: 2.49e4 },
  { h: 130, rhoMin: 8.377e3, rhoMax: 8.71e3 },
  { h: 140, rhoMin: 3.899e3, rhoMax: 4.059e3 },
  { h: 150, rhoMin: 2.122e3, rhoMax: 2.215e3 },
  { h: 160, rhoMin: 1.263e3, rhoMax: 1.344e3 },
  { h: 170, rhoMin: 8.008e2, rhoMax: 8.758e2 },
  { h: 180, rhoMin: 5.283e2, rhoMax: 6.01e2 },
  { h: 190, rhoMin: 3.617e2, rhoMax: 4.297e2 },
  { h: 200, rhoMin: 2.557e2, rhoMax: 3.162e2 },
  { h: 210, rhoMin: 1.839e2, rhoMax: 2.396e2 },
  { h: 220, rhoMin: 1.341e2, rhoMax: 1.853e2 },
  { h: 230, rhoMin: 9.949e1, rhoMax: 1.455e2 },
  { h: 240, rhoMin: 7.488e1, rhoMax: 1.157e2 },
  { h: 250, rhoMin: 5.709e1, rhoMax: 9.308e1 },
  { h: 260, rhoMin: 4.403e1, rhoMax: 7.555e1 },
  { h: 270, rhoMin: 3.43e1, rhoMax: 6.182e1 },
  { h: 280, rhoMin: 2.697e1, rhoMax: 5.095e1 },
  { h: 290, rhoMin: 2.139e1, rhoMax: 4.226e1 },
  { h: 300, rhoMin: 1.708e1, rhoMax: 3.526e1 },
  { h: 320, rhoMin: 1.099e1, rhoMax: 2.511e1 },
  { h: 340, rhoMin: 7.214e0, rhoMax: 1.819e1 },
  { h: 360, rhoMin: 4.824e0, rhoMax: 1.337e1 },
  { h: 380, rhoMin: 3.274e0, rhoMax: 9.955e0 },
  { h: 400, rhoMin: 2.249e0, rhoMax: 7.492e0 },
  { h: 420, rhoMin: 1.558e0, rhoMax: 5.684e0 },
  { h: 440, rhoMin: 1.091e0, rhoMax: 4.355e0 },
  { h: 460, rhoMin: 7.701e-1, rhoMax: 3.362e0 },
  { h: 480, rhoMin: 5.474e-1, rhoMax: 2.612e0 },
  { h: 500, rhoMin: 3.916e-1, rhoMax: 2.042e0 },
  { h: 520, rhoMin: 2.819e-1, rhoMax: 1.605e0 },
  { h: 540, rhoMin: 2.042e-1, rhoMax: 1.267e0 },
  { h: 560, rhoMin: 1.488e-1, rhoMax: 1.005e0 },
  { h: 580, rhoMin: 1.092e-1, rhoMax: 7.997e-1 },
  { h: 600, rhoMin: 8.07e-2, rhoMax: 6.39e-1 },
  { h: 620, rhoMin: 6.012e-2, rhoMax: 5.123e-1 },
  { h: 640, rhoMin: 4.519e-2, rhoMax: 4.121e-1 },
  { h: 660, rhoMin: 3.43e-2, rhoMax: 3.325e-1 },
  { h: 680, rhoMin: 2.632e-2, rhoMax: 2.691e-1 },
  { h: 700, rhoMin: 2.043e-2, rhoMax: 2.185e-1 },
  { h: 720, rhoMin: 1.607e-2, rhoMax: 1.779e-1 },
  { h: 740, rhoMin: 1.281e-2, rhoMax: 1.452e-1 },
  { h: 760, rhoMin: 1.036e-2, rhoMax: 1.19e-1 },
  { h: 780, rhoMin: 8.496e-3, rhoMax: 9.776e-2 },
  { h: 800, rhoMin: 7.069e-3, rhoMax: 8.059e-2 },
  { h: 840, rhoMin: 4.68e-3, rhoMax: 5.741e-2 },
  { h: 880, rhoMin: 3.2e-3, rhoMax: 4.21e-2 },
  { h: 920, rhoMin: 2.21e-3, rhoMax: 3.13e-2 },
  { h: 960, rhoMin: 1.56e-3, rhoMax: 2.36e-2 },
  { h: 1000, rhoMin: 1.15e-3, rhoMax: 1.81e-2 },
];

const G_PER_KM3_TO_KG_PER_KM3 = 1e-3; // 1 g = 1e-3 kg

export interface HarrisPriesterOptions {
  /** Equatorial radius used to convert |r| to geometric altitude (km). */
  readonly re: number;
  /**
   * Diurnal-bulge apex unit direction in the same inertial frame as the satellite
   * position. The bulge lags the sub-solar direction by ~30 deg in longitude; for
   * an Earth-centered inertial frame pass the (rotated) sun direction. Default +X.
   */
  readonly bulgeApex?: Vector3;
  /**
   * Cosine exponent n in the day/night weighting (cos^n of half the bulge angle).
   * Montenbruck & Gill use n = 2 (low inclination) to 6 (polar); default 2.
   */
  readonly exponent?: number;
  /** Override the density table (default: the M&G mean-activity table). */
  readonly table?: readonly HarrisPriesterRow[];
}

const norm = (v: Vector3): Vector3 => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

/**
 * Harris-Priester atmosphere: at altitude h, the min/max densities are log-linearly
 * interpolated between the bracketing table rows, then blended by the diurnal-bulge
 * weight w = ((1 + cos(psi)) / 2)^(n/2), where psi is the angle between the position
 * and the bulge apex (so the apex side gets rhoMax, the antapex rhoMin). Returns
 * kg/km^3. Throws on |r| outside the table's altitude span (fail loudly).
 */
export function harrisPriesterAtmosphere(opts: HarrisPriesterOptions): DensityModel {
  const table = opts.table ?? HP_MEAN;
  if (table.length < 2) throw new DragError('harrisPriesterAtmosphere needs at least 2 rows');
  for (let i = 1; i < table.length; i++) {
    if (table[i]!.h <= table[i - 1]!.h) throw new DragError('Harris-Priester rows must ascend in altitude');
  }
  const re = opts.re;
  const apex = norm(opts.bulgeApex ?? [1, 0, 0]);
  const n = opts.exponent ?? 2;
  const hLo = table[0]!.h;
  const hHi = table[table.length - 1]!.h;

  return {
    density(r: Vector3): number {
      const rmag = Math.hypot(r[0], r[1], r[2]);
      const h = rmag - re;
      if (h < hLo || h > hHi) {
        throw new DragError(`altitude ${h.toFixed(1)} km is outside the Harris-Priester table [${hLo}, ${hHi}] km`);
      }
      // Bracket the altitude.
      let i = 0;
      for (let k = 0; k < table.length - 1; k++) {
        if (h >= table[k]!.h && h <= table[k + 1]!.h) {
          i = k;
          break;
        }
      }
      const lo = table[i]!;
      const hi = table[i + 1]!;
      // Log-linear (exponential) interpolation within the band, the M&G form
      //   rho(h) = rho(h_i) * exp(-(h - h_i) / H),  H = (h_{i+1}-h_i)/ln(rho_i/rho_{i+1}).
      const rhoMin = logInterp(lo.h, lo.rhoMin, hi.h, hi.rhoMin, h);
      const rhoMax = logInterp(lo.h, lo.rhoMax, hi.h, hi.rhoMax, h);
      // Diurnal weight: cos(psi/2)^n with psi the angle from the bulge apex.
      const u = norm(r);
      const cosPsi = Math.max(-1, Math.min(1, u[0] * apex[0] + u[1] * apex[1] + u[2] * apex[2]));
      const w = Math.pow((1 + cosPsi) / 2, n / 2);
      const rhoGPerKm3 = rhoMin + (rhoMax - rhoMin) * w;
      return rhoGPerKm3 * G_PER_KM3_TO_KG_PER_KM3;
    },
  };
}

/** Exponential (log-linear) interpolation of a positive quantity across [x0,x1]. */
function logInterp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (y0 <= 0 || y1 <= 0) {
    // Linear fallback for a non-positive endpoint (keeps C0-continuity).
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const f = (x - x0) / (x1 - x0);
  return y0 * Math.pow(y1 / y0, f);
}

/** Exported for tests/UI: the mean-activity Harris-Priester table (g/km^3). */
export const HARRIS_PRIESTER_MEAN = HP_MEAN;
