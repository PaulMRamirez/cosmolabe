// IAU-1976 (Lieske) precession of the equator. We return the Mean-Of-Date to J2000
// (EME2000/GCRF to FK5 accuracy) matrix prec such that r_J2000 = prec * r_MOD, built
// from the three precession angles zeta, theta, z (Vallado, "Fundamentals of
// Astrodynamics", IAU-76). The standard FK5 form P = ROT3(-z) ROT2(theta) ROT3(-zeta)
// maps J2000 -> MOD; we assemble its transpose, ROT3(zeta) ROT2(-theta) ROT3(z), which
// maps MOD -> J2000 directly. The time argument ttt is TT in Julian centuries past
// J2000. (STK_PARITY_SPEC frames.)

import type { Mat3 } from '../force/types.ts';
import { mul, rot3 } from './mat3.ts';

// Arcseconds to radians.
const ARCSEC = Math.PI / (180 * 3600);

/** ROT2 (passive rotation about the y-axis): r_new = ROT2(a) r. Used only here. */
function rot2(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // [ c 0 -s ; 0 1 0 ; s 0 c ]
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

/**
 * IAU-1976 precession matrix mapping Mean-Of-Date to J2000 (FK5): r_J2000 = prec * r_MOD.
 * At ttt = 0 this is exactly the identity.
 */
export function precession(ttt: number): Mat3 {
  if (!Number.isFinite(ttt)) {
    throw new RangeError(`precession: ttt must be finite, got ${ttt}`);
  }
  const ttt2 = ttt * ttt;
  const ttt3 = ttt2 * ttt;

  // Lieske 1976 angles in arcseconds (Vallado eq. 3-88), then to radians.
  const zeta = (2306.2181 * ttt + 0.30188 * ttt2 + 0.017998 * ttt3) * ARCSEC;
  const theta = (2004.3109 * ttt - 0.42665 * ttt2 - 0.041833 * ttt3) * ARCSEC;
  const z = (2306.2181 * ttt + 1.09468 * ttt2 + 0.018203 * ttt3) * ARCSEC;

  // J2000 -> MOD is ROT3(-z) ROT2(theta) ROT3(-zeta) in Vallado's passive convention;
  // the MOD -> J2000 transpose is ROT3(zeta) ROT2(-theta) ROT3(z).
  return mul(rot3(zeta), mul(rot2(-theta), rot3(z)));
}
