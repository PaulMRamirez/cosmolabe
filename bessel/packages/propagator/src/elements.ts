// Analytic orbit propagation. Two-body propagation reuses CSPICE prop2b; the J2/J4
// mean-element propagator advances the node, periapsis, and mean anomaly at their
// secular rates and converts to a state via CSPICE conics each step (so the
// element-to-state Kepler math is CSPICE's, validated). (STK_PARITY_SPEC §4.1.)

import type { CartesianState, SpiceEngine } from '@bessel/spice';

/** A column-oriented ephemeris (km, km/s) over a set of epochs, in `frame`. */
export interface EphemerisTable {
  readonly frame: string;
  readonly et: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
}

/** Classical (Keplerian) elements at an epoch. Angles in radians, a in km. */
export interface ClassicalElements {
  readonly a: number;
  readonly e: number;
  readonly i: number;
  readonly raan: number;
  readonly argp: number;
  readonly m0: number;
  readonly epoch: number; // ET seconds
}

/** Central-body gravity parameters for the J2/J4 secular theory. */
export interface CentralBody {
  readonly gm: number; // km^3/s^2
  readonly j2: number;
  readonly re: number; // equatorial radius (km)
  readonly j4?: number;
}

/** Secular rates of node, argument of periapsis, and mean anomaly (rad/s). */
export interface SecularRates {
  readonly raanDot: number;
  readonly argpDot: number;
  readonly mDot: number;
}

/**
 * J2/J4 secular rates (Vallado, Fundamentals of Astrodynamics): nodal regression, apsidal
 * rotation, and the J2-corrected mean-motion, plus the first-order J4 secular corrections to
 * the node and perigee. With j2 = 0 and j4 = 0 the rates reduce to (0, 0, n0); when body.j4 is
 * omitted (or zero) only the J2 terms apply, so adding j4 perturbs the node and perigee drift on
 * top of the classical J2 theory (the J2-only zeros, e.g. critical inclination, stay intact).
 */
export function secularRatesJ2(a: number, e: number, i: number, body: CentralBody): SecularRates {
  const n0 = Math.sqrt(body.gm / a ** 3);
  const p = a * (1 - e * e);
  const reOverP2 = (body.re / p) ** 2;
  const factor = 1.5 * body.j2 * reOverP2 * n0; // leading J2 coefficient
  const cosi = Math.cos(i);
  const sin2i = Math.sin(i) ** 2;
  const eta2 = 1 - e * e;

  // First-order J2 contributions (the classical terms; unchanged so all J2-only zeros hold).
  const raanJ2 = -factor * cosi;
  const argpJ2 = factor * (2 - 2.5 * sin2i);
  const mJ2 = factor * Math.sqrt(eta2) * (1 - 1.5 * sin2i);

  // First-order J4 secular corrections (Vallado 9-39). Proportional to j4 * (re/p)^4 * n0, so they
  // vanish identically when j4 is unset. They refine the node and perigee drift on a long arc.
  const j4 = body.j4 ?? 0;
  const reOverP4 = reOverP2 * reOverP2;
  const j4Common = j4 * reOverP4 * n0;
  const raanJ4 = j4Common * (-1.875 * cosi) * ((1 + 1.5 * e * e) * (7 * sin2i - 4)) / 6;
  const argpJ4 =
    j4Common * (-0.46875) *
    (12 - 21 * sin2i + (-2.5 + e * e) * (15 - 35 * sin2i) * sin2i + (e * e) * (-21 + 49 * sin2i) * sin2i) / 4;

  return {
    raanDot: raanJ2 + raanJ4,
    argpDot: argpJ2 + argpJ4,
    mDot: n0 + mJ2,
  };
}

/** Allocate an EphemerisTable over the given epochs (et copied, column arrays zeroed). */
export function emptyTable(frame: string, et: Float64Array): EphemerisTable {
  const n = et.length;
  return {
    frame,
    et: Float64Array.from(et),
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    vz: new Float64Array(n),
  };
}

function setRow(table: EphemerisTable, k: number, s: CartesianState): void {
  // EphemerisTable columns are owned, mutable Float64Arrays during the build.
  (table.x as Float64Array)[k] = s.position.x;
  (table.y as Float64Array)[k] = s.position.y;
  (table.z as Float64Array)[k] = s.position.z;
  (table.vx as Float64Array)[k] = s.velocity.x;
  (table.vy as Float64Array)[k] = s.velocity.y;
  (table.vz as Float64Array)[k] = s.velocity.z;
}

/**
 * Two-body propagation of a Cartesian state (about gravitational parameter mu)
 * over an epoch grid, via CSPICE prop2b. `epoch` is the ET of `state`.
 */
export async function propagateTwoBody(
  spice: SpiceEngine,
  state: CartesianState,
  mu: number,
  epoch: number,
  etGrid: Float64Array,
  frame = 'J2000',
): Promise<EphemerisTable> {
  const table = emptyTable(frame, etGrid);
  for (let k = 0; k < etGrid.length; k++) {
    setRow(table, k, await spice.prop2b(mu, state, etGrid[k]! - epoch));
  }
  return table;
}

/** Largest valid odd Hermite degree (spkw13) for n points: odd, >=1, <= n-1. */
function hermiteDegree(requested: number, n: number): number {
  let d = Math.min(requested, n - 1);
  if (d % 2 === 0) d -= 1;
  return Math.max(1, d);
}

export interface PublishOptions {
  /** SPK file name in the in-memory FS. */
  readonly name: string;
  /** NAIF id for the propagated body (e.g. a negative spacecraft id). */
  readonly body: number;
  /** NAIF id of the segment center body. */
  readonly center: number;
  readonly segid?: string;
  /** Requested Hermite degree (clamped to odd and <= n-1); default 7. */
  readonly degree?: number;
}

/**
 * Publish an EphemerisTable as an in-memory SPK Type 13 segment and load it, so the
 * arc is queryable through the existing spkpos/spkezr pipeline (one geometry source
 * of truth). The propagated object then renders with no special-case code path.
 */
export async function publishEphemeris(
  spice: SpiceEngine,
  table: EphemerisTable,
  opts: PublishOptions,
): Promise<void> {
  const n = table.et.length;
  const states = new Float64Array(n * 6);
  for (let k = 0; k < n; k++) {
    states[k * 6] = table.x[k]!;
    states[k * 6 + 1] = table.y[k]!;
    states[k * 6 + 2] = table.z[k]!;
    states[k * 6 + 3] = table.vx[k]!;
    states[k * 6 + 4] = table.vy[k]!;
    states[k * 6 + 5] = table.vz[k]!;
  }
  await spice.writeSpkType13(
    opts.name,
    opts.body,
    opts.center,
    table.frame,
    opts.segid ?? 'BESSEL',
    hermiteDegree(opts.degree ?? 7, n),
    table.et,
    states,
  );
}

/**
 * J2/J4 mean-element propagation: advance the node, periapsis, and mean anomaly at
 * their secular rates, then convert to a state with CSPICE conics at each epoch.
 */
export async function propagateMeanElements(
  spice: SpiceEngine,
  el: ClassicalElements,
  body: CentralBody,
  etGrid: Float64Array,
  frame = 'J2000',
): Promise<EphemerisTable> {
  const rates = secularRatesJ2(el.a, el.e, el.i, body);
  const rp = el.a * (1 - el.e);
  const table = emptyTable(frame, etGrid);
  for (let k = 0; k < etGrid.length; k++) {
    const et = etGrid[k]!;
    const dt = et - el.epoch;
    const state = await spice.conics(
      {
        rp,
        ecc: el.e,
        inc: el.i,
        lnode: el.raan + rates.raanDot * dt,
        argp: el.argp + rates.argpDot * dt,
        m0: el.m0 + rates.mDot * dt,
        t0: et,
        mu: body.gm,
      },
      et,
    );
    setRow(table, k, state);
  }
  return table;
}
