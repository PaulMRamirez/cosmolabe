// TEME (True Equator, Mean Equinox) to J2000 (EME2000/GCRF to FK5 accuracy) transform
// for SGP4 output, following Vallado, Crawford, Hujsak & Kelso "Revisiting Spacetrack
// Report #3" (AIAA 2006-6753), Appendix C, teme2eci. The TEME -> J2000 rotation needs
// only precession (IAU-1976) + nutation (IAU-1980) + the 1982 equation of the equinoxes
// (geometric terms): it does NOT involve GMST, UT1, or polar motion, which appear only
// in the TEME -> ECEF chain. Hence the sole time argument is ttt (TT Julian centuries
// past J2000) and the only Earth-orientation inputs are the celestial-pole offsets
// ddpsi/ddeps. The same rotation is applied to position and velocity (Vallado treats the
// frame as inertial over the transform). (STK_PARITY_SPEC frames.)

import type { Mat3 } from '../force/types.ts';
import type { TemeState } from '../sgp4.ts';
import { mul, matVec, transpose, rot3 } from './mat3.ts';
import { precession } from './precession-1976.ts';
import { nutation } from './nutation-1980.ts';

/** Celestial-pole EOP corrections to the IAU-1980 nutation, in radians. */
export interface EarthOrientation {
  /** Correction to nutation in longitude, ddpsi (rad). */
  readonly ddpsi?: number;
  /** Correction to nutation in obliquity, ddeps (rad). */
  readonly ddeps?: number;
}

/** Seconds per Julian century (86400 * 36525). */
const SEC_PER_CENTURY = 86400 * 36525;

/**
 * The TEME -> J2000 rotation matrix at TT Julian centuries ttt:
 *   M = prec * nut * transpose(ROT3(eqeg)),  eqeg = deltapsi * cos(meaneps),
 * the 1982 equation of the equinoxes (geometric terms only), matching Vallado teme2eci.
 * Apply as r_J2000 = M * r_TEME.
 */
export function temeToJ2000Matrix(ttt: number, eop?: EarthOrientation): Mat3 {
  const { deltapsi, meaneps, nut } = nutation(ttt, eop?.ddpsi ?? 0, eop?.ddeps ?? 0);
  const prec = precession(ttt);
  const eqeg = deltapsi * Math.cos(meaneps);
  // transpose(ROT3(eqeg)) = ROT3(-eqeg); kept explicit for traceability to Vallado.
  const eqeRot = transpose(rot3(eqeg));
  return mul(prec, mul(nut, eqeRot));
}

/** Apply the TEME -> J2000 rotation to both position and velocity of a TEME state. */
export function temeToJ2000(
  state: TemeState,
  ttt: number,
  eop?: EarthOrientation,
): { position: [number, number, number]; velocity: [number, number, number] } {
  const m = temeToJ2000Matrix(ttt, eop);
  return {
    position: matVec(m, state.position),
    velocity: matVec(m, state.velocity),
  };
}

/** The inverse rotation J2000 -> TEME (the transpose of temeToJ2000Matrix). */
export function j2000ToTemeMatrix(ttt: number, eop?: EarthOrientation): Mat3 {
  return transpose(temeToJ2000Matrix(ttt, eop));
}

/** Apply the J2000 -> TEME rotation to both position and velocity of a J2000 state. */
export function j2000ToTeme(
  state: { readonly position: readonly [number, number, number]; readonly velocity: readonly [number, number, number] },
  ttt: number,
  eop?: EarthOrientation,
): { position: [number, number, number]; velocity: [number, number, number] } {
  const m = j2000ToTemeMatrix(ttt, eop);
  return {
    position: matVec(m, state.position),
    velocity: matVec(m, state.velocity),
  };
}

/**
 * Convenience wrapper taking et (TDB seconds past J2000) instead of ttt. We approximate
 * ttt = et / (86400 * 36525), i.e. we treat TT == TDB. The TT - TDB difference is at the
 * millisecond level (a periodic term under ~2 ms), which moves the precession/nutation
 * angles by far less than the sub-meter tolerance this transform targets, so the
 * approximation is immaterial here. Pass an explicit ttt via temeToJ2000 when working to
 * a stricter time standard.
 */
export function temeToJ2000AtEt(
  state: TemeState,
  et: number,
  eop?: EarthOrientation,
): { position: [number, number, number]; velocity: [number, number, number] } {
  return temeToJ2000(state, et / SEC_PER_CENTURY, eop);
}
