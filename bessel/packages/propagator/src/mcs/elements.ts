// Synchronous classical-element math for the MCS: coe2rv/rv2coe and trueAnomalyOf. The
// SPICE conics/oscelt equivalents are async (Web Worker round trips) and so unusable in
// the differential corrector's inner loop, which re-evaluates elements many times per
// Newton step. Standard Vallado formulation, J2000, central-body-centered. Degenerate
// (parabolic/rectilinear) orbits fail loudly. (STK_PARITY_SPEC §4.3.)

import type { Vec3 } from '@bessel/spice';
import type { KeplerianElements } from './segments.ts';
import { DegenerateElementsError } from './errors.ts';

const TWO_PI = 2 * Math.PI;
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mag = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export interface RvPair {
  readonly r: Vec3;
  readonly v: Vec3;
}

/** Full osculating element set, including the apsis radii and flight-path angle goals use. */
export interface OrbitElements {
  readonly sma: number;
  readonly ecc: number;
  readonly inc: number;
  readonly raan: number;
  readonly argp: number;
  readonly trueAnomaly: number;
  readonly raApo: number;
  readonly raPeri: number;
  readonly fpa: number;
}

/** Perifocal-to-inertial rotation applied to a perifocal vector (z component 0). */
function perifocalToInertial(raan: number, inc: number, argp: number, p: Vec3): Vec3 {
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(argp);
  const sw = Math.sin(argp);
  const r11 = cO * cw - sO * sw * ci;
  const r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci;
  const r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;
  return {
    x: r11 * p.x + r12 * p.y,
    y: r21 * p.x + r22 * p.y,
    z: r31 * p.x + r32 * p.y,
  };
}

/** Classical elements to a Cartesian [r, v] pair. */
export function coe2rv(mu: number, el: KeplerianElements): RvPair {
  if (Math.abs(el.ecc - 1) < 1e-8) {
    throw new DegenerateElementsError([], `parabolic eccentricity ${el.ecc} is unsupported`);
  }
  const p = el.sma * (1 - el.ecc * el.ecc);
  const nu = el.trueAnomaly;
  const cNu = Math.cos(nu);
  const sNu = Math.sin(nu);
  const rScale = p / (1 + el.ecc * cNu);
  const rPF: Vec3 = { x: rScale * cNu, y: rScale * sNu, z: 0 };
  const vScale = Math.sqrt(mu / p);
  const vPF: Vec3 = { x: -vScale * sNu, y: vScale * (el.ecc + cNu), z: 0 };
  return {
    r: perifocalToInertial(el.raan, el.inc, el.argp, rPF),
    v: perifocalToInertial(el.raan, el.inc, el.argp, vPF),
  };
}

/** Cartesian [r, v] to the full osculating element set. */
export function rv2coe(mu: number, r: Vec3, v: Vec3): OrbitElements {
  const rmag = mag(r);
  const vmag = mag(v);
  if (rmag < 1e-9 || vmag < 1e-12) throw new DegenerateElementsError([], 'zero position or velocity');
  const hvec = cross(r, v);
  const hmag = mag(hvec);
  if (hmag < 1e-9) throw new DegenerateElementsError([], 'rectilinear orbit (zero angular momentum)');

  const nvec: Vec3 = { x: -hvec.y, y: hvec.x, z: 0 };
  const nmag = mag(nvec);
  const rdotv = dot(r, v);
  const evec: Vec3 = {
    x: ((vmag * vmag - mu / rmag) * r.x - rdotv * v.x) / mu,
    y: ((vmag * vmag - mu / rmag) * r.y - rdotv * v.y) / mu,
    z: ((vmag * vmag - mu / rmag) * r.z - rdotv * v.z) / mu,
  };
  const ecc = mag(evec);
  if (Math.abs(ecc - 1) < 1e-8) throw new DegenerateElementsError([], `parabolic eccentricity ${ecc}`);

  const energy = (vmag * vmag) / 2 - mu / rmag;
  const sma = -mu / (2 * energy);
  const inc = Math.acos(clamp(hvec.z / hmag));

  let raan = nmag > 1e-9 ? Math.acos(clamp(nvec.x / nmag)) : 0;
  if (nmag > 1e-9 && nvec.y < 0) raan = TWO_PI - raan;

  let argp = 0;
  if (nmag > 1e-9 && ecc > 1e-9) {
    argp = Math.acos(clamp(dot(nvec, evec) / (nmag * ecc)));
    if (evec.z < 0) argp = TWO_PI - argp;
  }

  let trueAnomaly: number;
  if (ecc > 1e-9) {
    trueAnomaly = Math.acos(clamp(dot(evec, r) / (ecc * rmag)));
    if (rdotv < 0) trueAnomaly = TWO_PI - trueAnomaly;
  } else {
    // Circular: use the argument of latitude (angle from the ascending node, or x-axis).
    if (nmag > 1e-9) {
      trueAnomaly = Math.acos(clamp(dot(nvec, r) / (nmag * rmag)));
      if (r.z < 0) trueAnomaly = TWO_PI - trueAnomaly;
    } else {
      trueAnomaly = Math.acos(clamp(r.x / rmag));
      if (r.y < 0) trueAnomaly = TWO_PI - trueAnomaly;
    }
  }

  return {
    sma,
    ecc,
    inc,
    raan,
    argp,
    trueAnomaly,
    raApo: sma * (1 + ecc),
    raPeri: sma * (1 - ecc),
    fpa: Math.atan2(rdotv, hmag),
  };
}

/** True anomaly (rad, in [0, 2pi)) from a Cartesian state; the TrueAnomaly stop reads this. */
export function trueAnomalyOf(mu: number, r: Vec3, v: Vec3): number {
  return rv2coe(mu, r, v).trueAnomaly;
}

/** Clamp into [-1, 1] before acos to absorb rounding past the domain edge. */
function clamp(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
