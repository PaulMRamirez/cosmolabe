// Atmospheric drag, the dominant non-gravitational perturbation in low Earth orbit:
//   a = -0.5 * (Cd*A/m) * rho(r) * |v_rel| * v_rel,    v_rel = v - omega x r
// where omega is the central body's rotation vector (the co-rotating atmosphere) and
// rho(r) is the mass density from a pluggable DensityModel. The MVP density is a
// piecewise-exponential atmosphere (scale-height bands, USSA76/CIRA style) behind the
// DensityModel interface so NRLMSISE-00 can drop in later. The term is velocity-
// dependent: it supplies an analytic da/dv (the dominant sensitivity) and leaves da/dr
// to the model's finite-difference fallback (rho varies with altitude). References:
// Montenbruck & Gill, "Satellite Orbits", section 3.5; Vallado, "Fundamentals of
// Astrodynamics and Applications", section 8.6.2 and appendix B (USSA76 bands).
// (STK_PARITY_SPEC section 4.2.)

import { IntegrationError } from '../errors.ts';
import type { AccelPartials, ForceContext, ForceTerm, Mat3, Vector3 } from './types.ts';

/** Maps a body-centered position (km) to atmospheric mass density (kg/km^3). */
export interface DensityModel {
  /** Mass density (kg/km^3) at the given inertial position (km). */
  density(r: Vector3): number;
}

/** One exponential band: rho = rho0 * exp(-(h - h0)/H) for altitude h in [h0, h1). */
export interface ExponentialBand {
  /** Base geometric altitude of the band (km). */
  readonly h0: number;
  /** Reference density at h0 (kg/m^3). */
  readonly rho0: number;
  /** Scale height (km). */
  readonly H: number;
}

/** A bad drag configuration (e.g. an unsorted or empty band table). */
export class DragError extends IntegrationError {
  constructor(message: string) {
    super(`drag: ${message}`);
    this.name = 'DragError';
  }
}

// Vallado appendix B exponential atmosphere (USSA76), 0-1000 km, abridged to the bands
// that matter for LEO decay. h0 (km), nominal density (kg/m^3), scale height (km).
const VALLADO_USSA76: readonly ExponentialBand[] = [
  { h0: 0, rho0: 1.225, H: 7.249 },
  { h0: 25, rho0: 3.899e-2, H: 6.349 },
  { h0: 30, rho0: 1.774e-2, H: 6.682 },
  { h0: 40, rho0: 3.972e-3, H: 7.554 },
  { h0: 50, rho0: 1.057e-3, H: 8.382 },
  { h0: 60, rho0: 3.206e-4, H: 7.714 },
  { h0: 70, rho0: 8.77e-5, H: 6.549 },
  { h0: 80, rho0: 1.905e-5, H: 5.799 },
  { h0: 90, rho0: 3.396e-6, H: 5.382 },
  { h0: 100, rho0: 5.297e-7, H: 5.877 },
  { h0: 110, rho0: 9.661e-8, H: 7.263 },
  { h0: 120, rho0: 2.438e-8, H: 9.473 },
  { h0: 130, rho0: 8.484e-9, H: 12.636 },
  { h0: 140, rho0: 3.845e-9, H: 16.149 },
  { h0: 150, rho0: 2.07e-9, H: 22.523 },
  { h0: 180, rho0: 5.464e-10, H: 29.74 },
  { h0: 200, rho0: 2.789e-10, H: 37.105 },
  { h0: 250, rho0: 7.248e-11, H: 45.546 },
  { h0: 300, rho0: 2.418e-11, H: 53.628 },
  { h0: 350, rho0: 9.518e-12, H: 53.298 },
  { h0: 400, rho0: 3.725e-12, H: 58.515 },
  { h0: 450, rho0: 1.585e-12, H: 60.828 },
  { h0: 500, rho0: 6.967e-13, H: 63.822 },
  { h0: 600, rho0: 1.454e-13, H: 71.835 },
  { h0: 700, rho0: 3.614e-14, H: 88.667 },
  { h0: 800, rho0: 1.17e-14, H: 124.64 },
  { h0: 900, rho0: 5.245e-15, H: 181.05 },
  { h0: 1000, rho0: 3.019e-15, H: 268.0 },
];

const KG_PER_M3_TO_KG_PER_KM3 = 1e9; // 1 kg/m^3 = 1e9 kg/km^3

export interface ExponentialAtmosphereOptions {
  /** Equatorial radius used to convert |r| to geometric altitude (km). */
  readonly re: number;
  /** Override the band table (default: the Vallado USSA76 abridged bands). */
  readonly bands?: readonly ExponentialBand[];
}

/**
 * A piecewise-exponential atmosphere. Altitude h = |r| - re selects the band with the
 * largest h0 <= h; below the first band's h0 the first band is used, above the last the
 * last band continues (extrapolating its scale height). Returns kg/km^3 (the unit drag
 * expects, consistent with km-based positions).
 */
export function exponentialAtmosphere(opts: ExponentialAtmosphereOptions): DensityModel {
  const bands = opts.bands ?? VALLADO_USSA76;
  if (bands.length === 0) throw new DragError('exponentialAtmosphere needs at least one band');
  for (let i = 1; i < bands.length; i++) {
    if (bands[i]!.h0 <= bands[i - 1]!.h0) throw new DragError('bands must be strictly ascending in h0');
  }
  const re = opts.re;
  return {
    density(r: Vector3): number {
      const h = Math.hypot(r[0], r[1], r[2]) - re;
      // Largest band with h0 <= h (clamp to the first band below its base).
      let b = bands[0]!;
      for (let i = 0; i < bands.length; i++) {
        if (bands[i]!.h0 <= h) b = bands[i]!;
        else break;
      }
      const rhoKgM3 = b.rho0 * Math.exp(-(h - b.h0) / b.H);
      return rhoKgM3 * KG_PER_M3_TO_KG_PER_KM3;
    },
  };
}

export interface DragOptions {
  /** Drag coefficient (dimensionless), typically ~2.2 for a tumbling satellite. */
  readonly cd: number;
  /** Cross-sectional area (m^2). */
  readonly area: number;
  /** Spacecraft mass (kg). */
  readonly mass: number;
  /** The atmospheric density model. */
  readonly atmosphere: DensityModel;
  /** Central-body rotation vector (rad/s) in the inertial frame (default Earth +Z). */
  readonly omega?: Vector3;
}

// Earth's sidereal rotation rate (rad/s), the WGS-84 / IERS value.
const EARTH_ROTATION_RATE = 7.2921159e-5;

/**
 * An atmospheric-drag force term. The ballistic coefficient B = Cd*A/m is formed once;
 * note A is in m^2, m in kg, so B carries m^2/kg = 1e-6 km^2/kg, applied with rho in
 * kg/km^3 and velocity in km/s to yield km/s^2. v_rel subtracts the co-rotating
 * atmosphere (omega x r). Supplies analytic da/dv; da/dr is finite-differenced by the
 * model (rho's altitude dependence is left to the FD seam).
 */
export function drag(opts: DragOptions): ForceTerm {
  if (opts.mass <= 0) throw new DragError(`mass must be positive (got ${opts.mass})`);
  // Ballistic coefficient in km^2/kg: Cd*A[m^2]/m[kg] * (1e-6 km^2 / m^2).
  const bc = (opts.cd * opts.area) / opts.mass * 1e-6;
  const atmosphere = opts.atmosphere;
  const omega = opts.omega ?? ([0, 0, EARTH_ROTATION_RATE] as const);
  const [wx, wy, wz] = omega;

  const relVelocity = (ctx: ForceContext): Vector3 => {
    const [rx, ry, rz] = ctx.r;
    // omega x r
    const ox = wy * rz - wz * ry;
    const oy = wz * rx - wx * rz;
    const oz = wx * ry - wy * rx;
    return [ctx.v[0] - ox, ctx.v[1] - oy, ctx.v[2] - oz];
  };

  const acceleration = (ctx: ForceContext): Vector3 => {
    const rho = atmosphere.density(ctx.r);
    const vr = relVelocity(ctx);
    const vmag = Math.hypot(vr[0], vr[1], vr[2]);
    const k = -0.5 * bc * rho * vmag;
    return [k * vr[0], k * vr[1], k * vr[2]];
  };

  return {
    name: 'drag',
    acceleration,
    // da/dv at fixed rho: a = -0.5 B rho |w| w with w = v_rel (and dw/dv = I). Then
    //   da/dv = -0.5 B rho (|w| I + w w^T / |w|).
    // The rho dependence on r and the omega x r coupling go to the FD da/dr fallback.
    partials(ctx: ForceContext): AccelPartials {
      const rho = atmosphere.density(ctx.r);
      const vr = relVelocity(ctx);
      const vmag = Math.hypot(vr[0], vr[1], vr[2]);
      if (vmag === 0) {
        const zero: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        return { dadr: zero, dadv: zero };
      }
      const c = -0.5 * bc * rho;
      const inv = 1 / vmag;
      const [wx2, wy2, wz2] = vr;
      const dadv: Mat3 = [
        c * (vmag + wx2 * wx2 * inv), c * (wx2 * wy2 * inv), c * (wx2 * wz2 * inv),
        c * (wy2 * wx2 * inv), c * (vmag + wy2 * wy2 * inv), c * (wy2 * wz2 * inv),
        c * (wz2 * wx2 * inv), c * (wz2 * wy2 * inv), c * (vmag + wz2 * wz2 * inv),
      ];
      // da/dr from this analytic block is left to the model FD fallback. We still must
      // return a dadr; the model sums analytic dadr from every term that supplies one,
      // so returning a finite-difference here would double-count. Instead omit analytic
      // dadr by reporting it as the velocity-only contribution: the model treats a term
      // with partials() as fully analytic, so we compute dadr by central differencing
      // the acceleration in r here to keep the term self-consistent.
      const dadr = fdDadr(acceleration, ctx);
      return { dadr, dadv };
    },
  };
}

/** Central-difference da/dr of a term's acceleration (rho's altitude dependence). */
function fdDadr(accel: (ctx: ForceContext) => Vector3, ctx: ForceContext): Mat3 {
  const cbrtEps = Math.cbrt(Number.EPSILON);
  const base: [number, number, number] = [ctx.r[0], ctx.r[1], ctx.r[2]];
  const out = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    const delta = Math.max(1, Math.abs(base[j]!)) * cbrtEps;
    const rp: [number, number, number] = [base[0], base[1], base[2]];
    const rm: [number, number, number] = [base[0], base[1], base[2]];
    rp[j] = base[j]! + delta;
    rm[j] = base[j]! - delta;
    const ap = accel({ et: ctx.et, r: rp, v: ctx.v });
    const am = accel({ et: ctx.et, r: rm, v: ctx.v });
    for (let i = 0; i < 3; i++) out[i * 3 + j] = (ap[i]! - am[i]!) / (2 * delta);
  }
  return out as unknown as Mat3;
}
