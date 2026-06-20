// Jacchia 1971 (J71) upper-atmosphere density behind the DensityModel seam, with the
// F10.7/Ap space-weather drivers the exponential and Harris-Priester tables lack. Unlike
// Harris-Priester (a fixed min/max table for mean solar activity), J71 derives the whole
// thermosphere from a single physical scalar, the EXOSPHERIC TEMPERATURE T_inf, which is
// itself driven by the solar 10.7 cm flux (daily F10.7 and its 81-day average) and the
// geomagnetic Kp index, then modulated by the diurnal bulge (local solar time and latitude).
// Given T_inf, density follows from a Bates/Walker temperature profile and the barometric
// (diffusive-equilibrium) equation, calibrated to the J71 isopycnic boundary at 90 km. This
// is the canonical Jacchia 1971 temperature model; the density profile uses a single mean
// molecular mass (the standard barometric simplification) so it reduces exactly to a scale-
// height exponential at fixed temperature, the documented limit.
//
// References (see propagator/README.md "Algorithm and references"):
//   - L. G. Jacchia, "Revised Static Models of the Thermosphere and Exosphere with Empirical
//     Temperature Profiles", SAO Special Report 332 (1971): the night-minimum exospheric
//     temperature Tc = 379 + 3.24*Fbar + 1.3*(F - Fbar), the diurnal variation (exponents
//     m = 2.2, n = 3.0, amplitude R = 0.3), and the geomagnetic correction.
//   - C. E. Roberts, "An Analytic Model for Upper Atmosphere Densities Based Upon Jacchia's
//     1970 Models", Celestial Mechanics 4 (1971) 368-377: the analytic profile evaluation.
//   - Vallado, "Fundamentals of Astrodynamics and Applications", section 8.6.2 (J70/J71).
//   - Independent reference: SatelliteToolbox.jl jr1971 reports T_inf = 832.02 K for
//     F10.7 = 79, Fbar = 73.5, Kp = 1.34 (used as a sanity bound in the tests, not matched to
//     all digits since that requires Roberts' full multi-species diffusion integration).

import { DragError, type DensityModel } from './drag.ts';
import type { Vector3 } from './types.ts';

const DEG = Math.PI / 180;

/** Space-weather drivers for the Jacchia exospheric temperature. */
export interface JacchiaDrivers {
  /** Daily 10.7 cm solar flux F10.7 (solar flux units, sfu) for the previous day. */
  readonly f107: number;
  /** 81-day centered average of F10.7 (sfu). */
  readonly f107Bar: number;
  /** Geomagnetic planetary index Kp (0..9), with the standard ~6.7 h lag. */
  readonly kp: number;
}

/**
 * Global nighttime-minimum exospheric temperature Tc (K), Jacchia 1971:
 *   Tc = 379 + 3.24 * Fbar + 1.3 * (F - Fbar).
 * This is the floor temperature before the diurnal bulge and geomagnetic heating.
 */
export function nightMinExosphericTemp(d: JacchiaDrivers): number {
  return 379 + 3.24 * d.f107Bar + 1.3 * (d.f107 - d.f107Bar);
}

/**
 * Geomagnetic correction to the exospheric temperature (K), the J71 thermospheric form
 *   dT_inf = 28 * Kp + 0.03 * exp(Kp),
 * valid above ~200 km (the regime that matters for LEO drag). Monotonic in Kp.
 */
export function geomagneticDeltaTemp(kp: number): number {
  return 28 * kp + 0.03 * Math.exp(kp);
}

/**
 * Local exospheric temperature T_inf (K) from the night minimum Tc via the Jacchia 1971
 * diurnal bulge. eta and theta fold the geocentric latitude against the sub-solar declination;
 * tau is the local hour angle shifted so the bulge maximum trails the sub-solar point
 * (beta = -37 deg plus a 6 deg lead term). Exponents m = 2.2, n = 3.0, amplitude R = 0.3, so
 * the day/night ratio approaches (1 + R) = 1.3, the documented bulge amplitude.
 */
export function diurnalExosphericTemp(tc: number, latGc: number, declSun: number, hourAngle: number): number {
  const m = 2.2;
  const n = 3.0;
  const R = 0.3;
  const eta = 0.5 * Math.abs(latGc - declSun);
  const theta = 0.5 * Math.abs(latGc + declSun);
  // Bulge phase: tau = H - 37deg + 6deg*sin(H + 43deg) (Jacchia 1971).
  const tau = hourAngle - 37 * DEG + 6 * DEG * Math.sin(hourAngle + 43 * DEG);
  const cosEta = Math.pow(Math.abs(Math.cos(eta)), m);
  const sinTheta = Math.pow(Math.abs(Math.sin(theta)), m);
  const cosTauHalf = Math.pow(Math.abs(Math.cos(tau / 2)), n);
  return tc * (1 + R * (sinTheta + (cosEta - sinTheta) * cosTauHalf));
}

// Jacchia 1971 boundary conditions for the temperature profile.
const Z0 = 90; // isopycnic base altitude (km)
const T0 = 183; // temperature at Z0 (K), constant for all profiles
const ZX = 125; // inflection-point altitude (km)
const RHO0_KG_M3 = 3.46e-6; // mass density at the 90 km isopycnic boundary (kg/m^3), J71

// Physical constants for the barometric integration (mean thermospheric air).
const R_GAS = 8.31446; // J/(mol K)
const G0 = 9.80665; // m/s^2 surface gravity
const RE_MEAN_M = 6356.766e3; // mean Earth radius (m), J71 geopotential reference
const M_MEAN = 27.0e-3; // mean molecular mass (kg/mol) of thermospheric air (N2/O/O2 mix)
const KG_PER_M3_TO_KG_PER_KM3 = 1e9;

/**
 * Inflection-point temperature Tx (K) at 125 km, Jacchia's empirical fit to T_inf:
 *   Tx = 371.6678 + 0.0518806*Tinf - 294.3505*exp(-0.00216222*Tinf).
 */
function inflectionTemp(tInf: number): number {
  return 371.6678 + 0.0518806 * tInf - 294.3505 * Math.exp(-0.00216222 * tInf);
}

// Bates exospheric falloff rate s (per km): the temperature rises from Tx at 125 km toward the
// T_inf asymptote with an e-folding scale of ~1/s. A near-constant rate (Jacchia/Walker use
// ~0.025..0.035 /km) makes the profile reach within a few K of T_inf by ~250 km, the observed
// behavior. We scale it mildly with T_inf so a hotter exosphere fills out over a slightly
// greater height, keeping the larger scale height (lower density falloff) a hotter atmosphere
// must have.
function batesRate(tInf: number): number {
  return 0.0291 - 6.0e-6 * (tInf - 600); // /km, ~0.029 at 600 K, gently smaller when hotter
}

/**
 * Jacchia 1971 temperature at geometric altitude z (km) given T_inf. Below the inflection
 * (90..125 km) the profile is a monotone smoothstep from T0 at 90 km to Tx at 125 km (zero
 * slope at both ends, so it never dips below the isopycnic floor); above 125 km it is the Bates
 * exospheric form T = Tinf - (Tinf - Tx) exp(-s (z - zx)), which asymptotes to T_inf. C0 across
 * the inflection (density is taken C0 from this temperature, the relevant continuity).
 */
export function temperatureAt(tInf: number, z: number): number {
  const tx = inflectionTemp(tInf);
  if (z <= ZX) {
    const u = (z - Z0) / (ZX - Z0); // 0 at 90 km, 1 at 125 km
    const shape = u * u * (3 - 2 * u); // smoothstep: monotone, s(0)=0, s(1)=1, zero end slopes
    return T0 + (tx - T0) * shape;
  }
  const s = batesRate(tInf);
  return tInf - (tInf - tx) * Math.exp(-s * (z - ZX));
}

/** Mean gravity (m/s^2) at geometric altitude z (km), inverse-square from the mean radius. */
function gravityAt(z: number): number {
  const ratio = RE_MEAN_M / (RE_MEAN_M + z * 1e3);
  return G0 * ratio * ratio;
}

/** The barometric integrand -M g(z) / (R T(z)) (per metre). */
function integrand(tInf: number, z: number): number {
  return (-M_MEAN * gravityAt(z)) / (R_GAS * temperatureAt(tInf, z));
}

/**
 * Mass density (kg/km^3) at geometric altitude z (km) under diffusive equilibrium, by
 * integrating the barometric equation d(ln(rho*T))/dz = -M g / (R T) from the 90 km isopycnic
 * boundary. With a single mean molecular mass this is the J71 profile's barometric backbone;
 * at constant T it collapses to rho ~ exp(-(z - z0) M g / (R T)), an exponential atmosphere
 * with scale height H = R T / (M g), the limit the tests check.
 */
function densityAt(tInf: number, z: number): number {
  if (z < Z0) throw new DragError(`Jacchia altitude ${z.toFixed(1)} km is below the 90 km base`);
  const steps = Math.max(8, Math.ceil((z - Z0) / 2)); // ~2 km integration step
  const dz = (z - Z0) / steps; // km
  let integral = 0;
  let prev = integrand(tInf, Z0);
  for (let i = 1; i <= steps; i++) {
    const zi = Z0 + i * dz;
    const cur = integrand(tInf, zi);
    integral += 0.5 * (prev + cur) * dz * 1e3; // dz in metres
    prev = cur;
  }
  const tBase = temperatureAt(tInf, Z0);
  const tHere = temperatureAt(tInf, z);
  // rho(z) = rho0 * (T0 / T(z)) * exp(integral): the diffusive-equilibrium barometric solution.
  const rhoKgM3 = RHO0_KG_M3 * (tBase / tHere) * Math.exp(integral);
  return rhoKgM3 * KG_PER_M3_TO_KG_PER_KM3;
}

export interface JacchiaAtmosphereOptions {
  /** Equatorial radius used to convert |r| to geometric altitude (km). */
  readonly re: number;
  /** Space-weather drivers (F10.7, F10.7 average, Kp). */
  readonly drivers: JacchiaDrivers;
  /**
   * Sub-solar direction (unit, same inertial frame as the position) used for the diurnal
   * bulge: its declination sets eta/theta and its right ascension sets the local hour angle.
   * Default +X (sub-solar point on the frame's X axis, declination 0).
   */
  readonly sunDir?: Vector3;
  /** Upper altitude cap (km); above it the model throws (default 2500 km). */
  readonly maxAltitude?: number;
}

const norm = (v: Vector3): Vector3 => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

/**
 * A Jacchia 1971 density model. At a position it forms the geometric altitude, the local
 * geocentric latitude, and the local hour angle relative to the sub-solar direction, computes
 * the local exospheric temperature (night-min + diurnal + geomagnetic), then evaluates the
 * barometric density profile. Returns kg/km^3. Throws below 90 km or above the optional cap.
 */
export function jacchiaAtmosphere(opts: JacchiaAtmosphereOptions): DensityModel {
  const re = opts.re;
  const sun = norm(opts.sunDir ?? [1, 0, 0]);
  const declSun = Math.asin(Math.max(-1, Math.min(1, sun[2])));
  const raSun = Math.atan2(sun[1], sun[0]);
  const tc = nightMinExosphericTemp(opts.drivers);
  const dTg = geomagneticDeltaTemp(opts.drivers.kp);
  const hMax = opts.maxAltitude ?? 2500;

  return {
    density(r: Vector3): number {
      const rmag = Math.hypot(r[0], r[1], r[2]);
      const z = rmag - re;
      if (z < Z0) throw new DragError(`Jacchia altitude ${z.toFixed(1)} km is below the 90 km base`);
      if (z > hMax) throw new DragError(`Jacchia altitude ${z.toFixed(1)} km exceeds the cap ${hMax} km`);
      const latGc = Math.asin(Math.max(-1, Math.min(1, r[2] / rmag)));
      const raPos = Math.atan2(r[1], r[0]);
      const hourAngle = raPos - raSun; // local solar hour angle (0 at the sub-solar meridian)
      const tInf = diurnalExosphericTemp(tc, latGc, declSun, hourAngle) + dTg;
      return densityAt(tInf, z);
    },
  };
}

/** Exposed for tests/UI: the full local exospheric temperature at a sub-solar-relative point. */
export function exosphericTemperatureAt(
  drivers: JacchiaDrivers,
  latGc: number,
  declSun: number,
  hourAngle: number,
): number {
  const tc = nightMinExosphericTemp(drivers);
  return diurnalExosphericTemp(tc, latGc, declSun, hourAngle) + geomagneticDeltaTemp(drivers.kp);
}
