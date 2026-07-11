// Solar radiation pressure (SRP), the cannonball model: a flat-plate-equivalent sphere
// pushed anti-sunward by solar photons,
//   a = -nu * P_sun * (Cr*A/m) * (AU/|r_sat_to_sun|)^2 * sun_hat
// where sun_hat points from the satellite toward the Sun (so the acceleration points
// away from the Sun), P_sun is the solar pressure at 1 AU, and nu is a cylindrical
// shadow factor (0 in the Earth's umbra, 1 in full sunlight). The Sun position is a
// supplied synchronous positionAt closure (resolve a SPICE spkpos up front, like
// third-body.ts), so the integrator never awaits. da/dr is finite-differenced by the
// model (the shadow boundary is non-smooth; the cannonball interior is smooth).
// References: Montenbruck & Gill, "Satellite Orbits", section 3.4; Vallado,
// "Fundamentals of Astrodynamics and Applications", section 8.6.4. (STK_PARITY_SPEC
// section 4.2.)

import { IntegrationError } from '../errors.ts';
import type { ForceContext, ForceTerm, Vector3 } from './types.ts';

/** A synchronous Sun position (km, relative to the central body) at an epoch. */
export type SunPositionAt = (et: number) => Vector3;

export interface SrpOptions {
  /** Radiation-pressure (reflectivity) coefficient Cr, 1 (absorbing) to 2 (reflecting). */
  readonly cr: number;
  /** Cross-sectional area (m^2). */
  readonly area: number;
  /** Spacecraft mass (kg). */
  readonly mass: number;
  /** Sun position (km, central-body-centered) at an epoch. */
  readonly sunPosition: SunPositionAt;
  /** Central-body (occulting) radius for the cylindrical shadow (km), e.g. Earth Re. */
  readonly occultingRadius: number;
  /** Solar pressure at 1 AU (N/m^2). Default 4.56e-6 (Montenbruck & Gill). */
  readonly pressure?: number;
  /** One astronomical unit (km). Default the IAU 2012 value. */
  readonly au?: number;
}

/** A bad SRP configuration (non-positive mass, area, or radius). */
export class SrpError extends IntegrationError {
  constructor(message: string) {
    super(`srp: ${message}`);
    this.name = 'SrpError';
  }
}

const SOLAR_PRESSURE_1AU = 4.56e-6; // N/m^2 (= kg/(m s^2)) at 1 AU
const AU_KM = 1.495978707e8; // km

/**
 * Cylindrical (umbra-only) shadow factor: 0 when the satellite is behind the central
 * body relative to the Sun and within the body's geometric shadow cylinder, else 1.
 * `rSat` and `rSun` are central-body-centered (km).
 */
export function cylindricalShadow(rSat: Vector3, rSun: Vector3, occultingRadius: number): number {
  // Unit vector from the central body toward the Sun.
  const sunMag = Math.hypot(rSun[0], rSun[1], rSun[2]);
  const sx = rSun[0] / sunMag;
  const sy = rSun[1] / sunMag;
  const sz = rSun[2] / sunMag;
  // Projection of the satellite position onto the Sun direction.
  const proj = rSat[0] * sx + rSat[1] * sy + rSat[2] * sz;
  // In sunlight if on the sunward side (proj >= 0) of the body.
  if (proj >= 0) return 1;
  // Perpendicular distance from the central-body -> anti-Sun axis.
  const px = rSat[0] - proj * sx;
  const py = rSat[1] - proj * sy;
  const pz = rSat[2] - proj * sz;
  const perp = Math.hypot(px, py, pz);
  // Inside the cylinder of the occulting body's radius -> umbra (no force).
  return perp < occultingRadius ? 0 : 1;
}

/**
 * A cannonball SRP force term. The pressure scale P_sun*(Cr*A/m)*AU^2 is formed once;
 * A is in m^2 and m in kg, so the m^2/kg group carries a 1e-6 km^2/m^2 conversion, and
 * with P in N/m^2 = kg/(m s^2) and distances in km the result is km/s^2. The shadow is
 * the cylindrical umbra of `occultingRadius`. da/dr is left to the model FD fallback.
 */
export function srp(opts: SrpOptions): ForceTerm {
  if (opts.mass <= 0) throw new SrpError(`mass must be positive (got ${opts.mass})`);
  if (opts.occultingRadius <= 0) throw new SrpError(`occultingRadius must be positive (got ${opts.occultingRadius})`);
  const pressure = opts.pressure ?? SOLAR_PRESSURE_1AU;
  const au = opts.au ?? AU_KM;
  // Pressure * Cr * A/m * AU^2. A[m^2]/m[kg] * P[kg/(m s^2)] = kg/(m s^2) * m^2/kg
  //   = m/s^2; convert the length to km via *1e-3 (m -> km). Then * AU^2[km^2] / r^2[km^2]
  // gives km/s^2. So the scalar coefficient below already folds in the 1e-3.
  const coeff = pressure * opts.cr * (opts.area / opts.mass) * 1e-3 * au * au;
  const sunPosition = opts.sunPosition;
  const occultingRadius = opts.occultingRadius;

  return {
    name: 'srp',
    acceleration(ctx: ForceContext): Vector3 {
      const rSun = sunPosition(ctx.et);
      const nu = cylindricalShadow(ctx.r, rSun, occultingRadius);
      if (nu === 0) return [0, 0, 0];
      // Vector from the satellite toward the Sun.
      const dx = rSun[0] - ctx.r[0];
      const dy = rSun[1] - ctx.r[1];
      const dz = rSun[2] - ctx.r[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2);
      // a = -coeff * (1/d^2) * sun_hat = -coeff * (sun_vec / d^3). The minus sign points
      // anti-sunward (away from the Sun).
      const k = -(coeff * nu) / (d2 * d);
      return [k * dx, k * dy, k * dz];
    },
  };
}
