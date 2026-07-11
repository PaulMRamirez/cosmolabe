// Explicit covariance INPUT for the Conjunction tab (analysis-UX Phase 2, decision 1 / the
// "input a per-object covariance" SSA-analyst acceptance in section 4). When an ingested
// catalog did NOT carry a covariance (an OEM or a TLE set), the analyst supplies an assumed
// position covariance for an object so the per-event card can report a FULL-covariance Pc
// instead of only the Max-Pc bound. The input is a 3x3 position covariance (km^2) expressed
// either in the RTN (radial / transverse / normal) local frame or in the inertial J2000 frame;
// an RTN covariance is rotated to inertial with the object's own state at the encounter epoch,
// matching exactly how the CDM RTN block is handled in ingest.ts. This module is pure and
// SPICE-free, returning numbers in inertial km^2, so the covariance-input -> 2x2 encounter
// projection -> Pc chain is unit-testable directly. Every degenerate input fails loud with a
// typed, located CovarianceInputError (a non-positive-definite supplied covariance is a hard
// error, not a silently clamped value).

import { combineEncounter, encounterPlanePc } from './bplane-geometry.ts';

/** The frame a supplied covariance is expressed in. */
export type CovarianceFrame = 'rtn' | 'inertial';

/** A loud, located error for a malformed or non-positive-definite supplied covariance. */
export class CovarianceInputError extends Error {
  constructor(message: string) {
    super(`covariance input: ${message}`);
    this.name = 'CovarianceInputError';
  }
}

/**
 * The analyst's supplied covariance for one object: a 3x3 position covariance (km^2, row-major
 * length 9, symmetric) in the named frame. The form builds this from either three per-axis
 * sigmas (a diagonal covariance) or the six independent entries of a full symmetric 3x3.
 */
export interface SuppliedCovarianceInput {
  /** Row-major 3x3 position covariance (km^2). The (0,1,2) axes are (R,T,N) for the rtn frame
   *  or (X,Y,Z) for the inertial frame. */
  readonly matrix3: readonly number[];
  /** The frame the matrix is expressed in. */
  readonly frame: CovarianceFrame;
}

/** A built inertial-frame supplied covariance: the inertial 3x3 (km^2) plus the object 6-state
 *  (km, km/s) it was referenced to, ready to combine in the encounter plane exactly like an
 *  ingested CDM covariance. */
export interface SuppliedCovariance {
  /** Inertial 3x3 position covariance (km^2), row-major length 9. */
  readonly posCov3: Float64Array;
  /** The object inertial 6-state [x,y,z,vx,vy,vz] (km, km/s) at the encounter epoch. */
  readonly state6: Float64Array;
}

/** Build a diagonal 3x3 (row-major length 9) from three per-axis sigmas (km): C = diag(sigma^2). */
export function diagonalCovariance(sigmaR: number, sigmaT: number, sigmaN: number): number[] {
  for (const [name, s] of [['R', sigmaR], ['T', sigmaT], ['N', sigmaN]] as const) {
    if (!Number.isFinite(s)) throw new CovarianceInputError(`sigma ${name} must be finite (got ${s})`);
    if (s <= 0) throw new CovarianceInputError(`sigma ${name} must be positive (got ${s})`);
  }
  return [sigmaR * sigmaR, 0, 0, 0, sigmaT * sigmaT, 0, 0, 0, sigmaN * sigmaN];
}

/** Assert a row-major 3x3 is finite and symmetric (within a relative tolerance), failing loud. */
function assertSymmetric3(m: readonly number[]): void {
  if (m.length !== 9) throw new CovarianceInputError(`a 3x3 covariance needs 9 entries (got ${m.length})`);
  if (!m.every(Number.isFinite)) throw new CovarianceInputError('covariance entries must all be finite');
  const offDiag: readonly (readonly [number, number])[] = [
    [1, 3],
    [2, 6],
    [5, 7],
  ];
  for (const [a, b] of offDiag) {
    const scale = 1 + Math.abs(m[a]!) + Math.abs(m[b]!);
    if (Math.abs(m[a]! - m[b]!) > 1e-9 * scale) {
      throw new CovarianceInputError(`covariance must be symmetric (entry ${a} != entry ${b})`);
    }
  }
}

/** Assert a symmetric 3x3 is positive-definite via leading-principal-minor (Sylvester) tests. */
function assertPositiveDefinite3(m: readonly number[]): void {
  const a = m[0]!;
  const minor2 = m[0]! * m[4]! - m[1]! * m[3]!;
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  if (a <= 0 || minor2 <= 0 || det <= 0) {
    throw new CovarianceInputError(
      `supplied covariance must be positive-definite (leading minors ${a}, ${minor2}, ${det})`,
    );
  }
}

/** Build the RTN->inertial 3x3 rotation (columns radial, transverse, normal) from an inertial
 *  6-state. Identical construction to ingest.ts (R = r-hat, N = (r x v)-hat, T = N x R); throws
 *  loud on a degenerate (zero |r| or parallel r,v) state. Row-major length 9. */
function rtnToInertialRotation(state6: ArrayLike<number>): Float64Array {
  const rx = state6[0]!, ry = state6[1]!, rz = state6[2]!;
  const vx = state6[3]!, vy = state6[4]!, vz = state6[5]!;
  const rMag = Math.hypot(rx, ry, rz);
  if (rMag <= 0) throw new CovarianceInputError('object state has a zero position vector; cannot build the RTN frame');
  const R = [rx / rMag, ry / rMag, rz / rMag] as const;
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.hypot(hx, hy, hz);
  if (hMag <= 0) throw new CovarianceInputError('object state has parallel position and velocity; no orbit plane for RTN');
  const N = [hx / hMag, hy / hMag, hz / hMag] as const;
  const T = [N[1] * R[2] - N[2] * R[1], N[2] * R[0] - N[0] * R[2], N[0] * R[1] - N[1] * R[0]] as const;
  return Float64Array.of(R[0], T[0], N[0], R[1], T[1], N[1], R[2], T[2], N[2]);
}

/** Rotate a 3x3 covariance by a 3x3 rotation: C_out = M C M^T. Row-major length 9 in and out. */
function rotateCovariance3(cov: readonly number[], m: Float64Array): Float64Array {
  const mC = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k]! * cov[k * 3 + j]!;
      mC[i * 3 + j] = s;
    }
  const out = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += mC[i * 3 + k]! * m[j * 3 + k]!; // M^T -> m[j][k]
      out[i * 3 + j] = s;
    }
  return out;
}

/**
 * Build an inertial supplied covariance from the analyst's input + the object's 6-state. The
 * matrix is validated symmetric and positive-definite (fail loud); an RTN matrix is rotated to
 * inertial with the object's state, an inertial matrix is taken as-is. The returned 3x3 is in the
 * same inertial convention as an ingested CDM covariance, so it combines in the encounter plane
 * identically. The state6 is needed both for the RTN rotation and for the encounter-frame build.
 */
export function buildSuppliedCovariance(input: SuppliedCovarianceInput, state6: ArrayLike<number>): SuppliedCovariance {
  assertSymmetric3(input.matrix3);
  assertPositiveDefinite3(input.matrix3);
  const state = Float64Array.from(state6, (v) => v);
  if (state.length !== 6) throw new CovarianceInputError(`object state must be a 6-state (got length ${state.length})`);
  const posCov3 =
    input.frame === 'inertial'
      ? Float64Array.from(input.matrix3)
      : rotateCovariance3(input.matrix3, rtnToInertialRotation(state));
  return { posCov3, state6: state };
}

/** The encounter-plane reduction of two supplied/ingested covariances: the 2x2 in-plane
 *  covariance entries, the projected miss, and the resulting full-covariance Pc. */
export interface SuppliedEncounterPc {
  readonly cxx: number;
  readonly cxy: number;
  readonly cyy: number;
  readonly missXKm: number;
  readonly missYKm: number;
  readonly missKm: number;
  readonly relSpeedKmS: number;
  readonly pc: number;
}

/**
 * The pure covariance-input -> 2x2 encounter projection -> Pc chain: combine the two objects'
 * inertial 6-states + inertial 3x3 position covariances into the encounter plane (combineEncounter,
 * normal to the relative velocity) and integrate the full-covariance Foster Pc (encounterPlanePc)
 * over the combined hard-body disk. This is the function the supplied-covariance path runs (the
 * covariance came from the analyst, not the CDM, but the encounter-plane math is identical). Pure
 * and directly unit-testable. Throws loud (via encounterPlanePc / eigenCov2) on a degenerate or
 * non-positive-definite combined covariance.
 */
export function suppliedEncounterPc(
  primaryState6: ArrayLike<number>,
  primaryPosCov3: ArrayLike<number>,
  secondaryState6: ArrayLike<number>,
  secondaryPosCov3: ArrayLike<number>,
  radiusKm: number,
): SuppliedEncounterPc {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new CovarianceInputError(`combined hard-body radius must be a non-negative finite number (got ${radiusKm})`);
  }
  const enc = combineEncounter(primaryState6, primaryPosCov3, secondaryState6, secondaryPosCov3);
  const pc = encounterPlanePc(enc.cov2, enc.missXKm, enc.missYKm, radiusKm);
  return {
    cxx: enc.cov2.cxx,
    cxy: enc.cov2.cxy,
    cyy: enc.cov2.cyy,
    missXKm: enc.missXKm,
    missYKm: enc.missYKm,
    missKm: enc.missKm,
    relSpeedKmS: enc.relSpeedKmS,
    pc,
  };
}
