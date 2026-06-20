// Measurement models: for each Measurement kind, the predicted value h(state) and the
// measurement partial dh/dx (a 1x6 or 2x6 row-major Jacobian with respect to the full
// Cartesian state at the measurement epoch). All analytic. The state and the observer
// share an inertial frame; the observer is treated as inertial (its velocity is zero in
// that frame), the standard ground-station-in-ECI convention.
//
//   rho      = r_sat - r_obs            (line-of-sight, km)
//   range    = |rho|                    dh/dr = rho/|rho|, dh/dv = 0
//   rangeRate= (rho . v)/|rho|          chain rule below
//   ra       = atan2(rho_y, rho_x)
//   dec      = asin(rho_z/|rho|)
//   az/el    in a local ENU frame from rho's components along (east, north, up)
//
// (Vallado §4.4 and §10.2; Tapley-Schutz-Born §3.4.)

import { MeasurementError } from './errors.ts';
import { bennettRefraction, bennettRefractionSlope, type RefractionConditions } from './refraction.ts';
import type { Measurement, ObserverPosition } from './types.ts';

/** A measurement prediction: the model value(s) and the row-major (size x 6) Jacobian. */
export interface Prediction {
  /** Predicted measurement components: length 1 (range/rate) or 2 (angles). */
  readonly value: Float64Array;
  /** dh/dx, row-major, (size x 6): rows = components, cols = [x,y,z,vx,vy,vz]. */
  readonly jac: Float64Array;
}

function los(rState: readonly [number, number, number], obs: ObserverPosition): [number, number, number] {
  return [rState[0] - obs[0], rState[1] - obs[1], rState[2] - obs[2]];
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Predict a measurement from a 6-state (length 6: [x,y,z,vx,vy,vz]) at its epoch. The
 * observer position rides on the measurement. Pure: no propagation, just geometry.
 */
export function predict(m: Measurement, state6: ArrayLike<number>): Prediction {
  if (state6.length !== 6) throw new MeasurementError(`predict expects a 6-state (got length ${state6.length})`);
  const r: [number, number, number] = [state6[0]!, state6[1]!, state6[2]!];
  const v: [number, number, number] = [state6[3]!, state6[4]!, state6[5]!];
  const rho = los(r, m.observer);
  const range = Math.hypot(rho[0], rho[1], rho[2]);
  if (range === 0) throw new MeasurementError('predict: observer coincides with target (zero range)');

  switch (m.kind) {
    case 'range': {
      const jac = new Float64Array(6);
      jac[0] = rho[0] / range;
      jac[1] = rho[1] / range;
      jac[2] = rho[2] / range;
      // dh/dv = 0
      return { value: Float64Array.of(range), jac };
    }
    case 'rangeRate': {
      // rdot = (rho . v) / |rho|.
      const rhoDotV = dot3(rho, v);
      const rdot = rhoDotV / range;
      // d(rdot)/dr = v/|rho| - (rho.v) rho / |rho|^3.
      // d(rdot)/dv = rho/|rho|.
      const jac = new Float64Array(6);
      const r3 = range * range * range;
      for (let i = 0; i < 3; i++) {
        jac[i] = v[i]! / range - (rhoDotV * rho[i]!) / r3;
        jac[3 + i] = rho[i]! / range;
      }
      return { value: Float64Array.of(rdot), jac };
    }
    case 'angles': {
      if (m.frame === 'radec') return predictRaDec(rho, range);
      return predictAzEl(m, rho);
    }
    default: {
      const exhaustive: never = m;
      throw new MeasurementError(`unknown measurement kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Topocentric right ascension / declination and their 2x6 Jacobian (dh/dv = 0). */
function predictRaDec(rho: readonly [number, number, number], range: number): Prediction {
  const [x, y, z] = rho;
  const ra = Math.atan2(y, x);
  const dec = Math.asin(z / range);

  const rxy2 = x * x + y * y;
  if (rxy2 === 0) {
    throw new MeasurementError('predictRaDec: line of sight along the pole, right ascension is undefined');
  }
  // d(ra)/dr: ra = atan2(y, x) => d/dx = -y/rxy2, d/dy = x/rxy2, d/dz = 0.
  // d(dec)/dr: dec = asin(z/range). Let rho = range. d(dec)/dr_i =
  //   (delta_iz * range^2 - z * rho_i) / (range^2 * sqrt(rxy2)).
  const jac = new Float64Array(12); // 2x6, last three cols (velocity) zero.
  jac[0] = -y / rxy2;
  jac[1] = x / rxy2;
  jac[2] = 0;
  const r2 = range * range;
  const sqrtRxy = Math.sqrt(rxy2);
  jac[6 + 0] = (-z * x) / (r2 * sqrtRxy);
  jac[6 + 1] = (-z * y) / (r2 * sqrtRxy);
  jac[6 + 2] = (r2 - z * z) / (r2 * sqrtRxy);
  return { value: Float64Array.of(ra, dec), jac };
}

/**
 * Azimuth (from North, clockwise, positive toward East) and elevation in a local ENU
 * frame, with the 2x6 Jacobian (dh/dv = 0). Projects rho onto the supplied ENU axes:
 *   e = rho.east, n = rho.north, u = rho.up
 *   az = atan2(e, n)              el = asin(u / |rho|)
 */
function predictAzEl(m: Extract<Measurement, { kind: 'angles' }>, rho: readonly [number, number, number]): Prediction {
  if (!m.enu) throw new MeasurementError('predictAzEl: azel measurement requires its enu axes');
  const { east, north, up } = m.enu;
  const e = dot3(rho, east as [number, number, number]);
  const n = dot3(rho, north as [number, number, number]);
  const u = dot3(rho, up as [number, number, number]);
  const range = Math.hypot(rho[0], rho[1], rho[2]);
  const az = Math.atan2(e, n);
  const elGeom = Math.asin(u / range); // geometric (vacuum) elevation

  const en2 = e * e + n * n;
  if (en2 === 0) throw new MeasurementError('predictAzEl: line of sight along local vertical, azimuth is undefined');

  // Optional tropospheric refraction: the apparent elevation is el + R(el), and the elevation
  // partial picks up the chain factor (1 + dR/del). Azimuth is unaffected (vertical bending).
  const refr = refractionOption(m.refraction);
  const el = refr ? elGeom + bennettRefraction(elGeom, refr.conditions) : elGeom;
  const elChain = refr ? 1 + bennettRefractionSlope(elGeom, refr.conditions) : 1;

  // d(az)/d(e,n) = (n/en2, -e/en2); d(e,n)/dr = east, north (constant unit vectors).
  // d(el)/dr_i: el = asin(u/range), u = up.rho, range = |rho|.
  //   d(el)/dr_i = ( up_i * range - u * rho_i/range ) / ( range^2 * sqrt(1 - (u/range)^2) ).
  const jac = new Float64Array(12);
  const dAz_de = n / en2;
  const dAz_dn = -e / en2;
  const sinEl = u / range;
  const cosEl = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
  if (cosEl === 0) throw new MeasurementError('predictAzEl: elevation at zenith, derivative is singular');
  const r2 = range * range;
  for (let i = 0; i < 3; i++) {
    const dE = (east as [number, number, number])[i]!;
    const dN = (north as [number, number, number])[i]!;
    const dU = (up as [number, number, number])[i]!;
    const drange = rho[i]! / range;
    jac[i] = dAz_de * dE + dAz_dn * dN;
    const dU_over_range = (dU * range - u * drange) / r2;
    jac[6 + i] = (dU_over_range / cosEl) * elChain;
  }
  return { value: Float64Array.of(az, el), jac };
}

/** Normalize the measurement's `refraction` option to either off or its site conditions. */
function refractionOption(
  opt: boolean | { readonly pressureMbar?: number; readonly temperatureK?: number } | undefined,
): { conditions: RefractionConditions | undefined } | null {
  if (!opt) return null;
  if (opt === true) return { conditions: undefined };
  return { conditions: opt };
}

/**
 * The residual measurement minus model, wrapping any angular component into (-pi, pi]
 * so a measurement near +/-pi differences cleanly. `size` is the measurement size.
 */
export function residual(m: Measurement, predicted: Float64Array): Float64Array {
  if (m.kind === 'range') return Float64Array.of(m.value - predicted[0]!);
  if (m.kind === 'rangeRate') return Float64Array.of(m.value - predicted[0]!);
  const d0 = wrapPi(m.value[0] - predicted[0]!);
  const d1 = m.value[1] - predicted[1]!; // declination/elevation in (-pi/2, pi/2): no wrap needed
  return Float64Array.of(d0, d1);
}

/** Wrap an angle difference into (-pi, pi]. */
export function wrapPi(d: number): number {
  let x = d;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** The measurement-noise variances (sigma^2) as a diagonal length-`size` vector. */
export function noiseVariances(m: Measurement): Float64Array {
  if (m.kind === 'angles') {
    return Float64Array.of(m.sigma[0] * m.sigma[0], m.sigma[1] * m.sigma[1]);
  }
  return Float64Array.of(m.sigma * m.sigma);
}
