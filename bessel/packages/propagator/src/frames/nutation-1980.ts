// IAU-1980 nutation theory (Wahr), the full 106-term series. Produces the nutation in
// longitude (deltapsi) and obliquity (deltaeps), the mean and true obliquity, and the
// True-Of-Date to Mean-Of-Date rotation nut such that r_MOD = nut * r_TOD, assembled as
// ROT1(-meaneps) ROT3(deltapsi) ROT1(trueeps) in Vallado's passive convention. The
// celestial-pole EOP corrections ddpsi/ddeps (radians) are added to deltapsi/deltaeps.
// The time argument ttt is TT in Julian centuries past J2000.
//
// The 106 coefficient rows are transcribed verbatim from the IAU-1980 series as
// published in ERFA/SOFA nut80 (https://github.com/liberfa/erfa, src/nut80.c), which is
// the canonical machine-readable form of the table in Seidelmann (1982) and Vallado's
// nut80.dat. Columns: the five Delaunay multipliers (l, l', F, D, Omega), then the
// longitude coefficients (sp + spt*T) and the obliquity coefficients (ce + cet*T), the
// coefficients being in units of 1e-4 arcsec (0.1 mas). (STK_PARITY_SPEC frames.)

import type { Mat3 } from '../force/types.ts';
import { mul, rot1, rot3 } from './mat3.ts';

const ARCSEC = Math.PI / (180 * 3600);
const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
// 1e-4 arcsec (0.1 milliarcsec) to radians: the table's coefficient unit.
const U = 1e-4 * ARCSEC;

interface NutTerm {
  readonly l: number;
  readonly lp: number;
  readonly f: number;
  readonly d: number;
  readonly om: number;
  readonly sp: number; // longitude constant, 1e-4 arcsec
  readonly spt: number; // longitude rate, 1e-4 arcsec / century
  readonly ce: number; // obliquity constant, 1e-4 arcsec
  readonly cet: number; // obliquity rate, 1e-4 arcsec / century
}

// prettier-ignore
const RAW: ReadonlyArray<readonly [number, number, number, number, number, number, number, number, number]> = [
  [ 0,  0,  0,  0,  1, -171996.0, -174.2,  92025.0,    8.9],
  [ 0,  0,  0,  0,  2,    2062.0,    0.2,   -895.0,    0.5],
  [-2,  0,  2,  0,  1,      46.0,    0.0,    -24.0,    0.0],
  [ 2,  0, -2,  0,  0,      11.0,    0.0,      0.0,    0.0],
  [-2,  0,  2,  0,  2,      -3.0,    0.0,      1.0,    0.0],
  [ 1, -1,  0, -1,  0,      -3.0,    0.0,      0.0,    0.0],
  [ 0, -2,  2, -2,  1,      -2.0,    0.0,      1.0,    0.0],
  [ 2,  0, -2,  0,  1,       1.0,    0.0,      0.0,    0.0],
  [ 0,  0,  2, -2,  2,  -13187.0,   -1.6,   5736.0,   -3.1],
  [ 0,  1,  0,  0,  0,    1426.0,   -3.4,     54.0,   -0.1],
  [ 0,  1,  2, -2,  2,    -517.0,    1.2,    224.0,   -0.6],
  [ 0, -1,  2, -2,  2,     217.0,   -0.5,    -95.0,    0.3],
  [ 0,  0,  2, -2,  1,     129.0,    0.1,    -70.0,    0.0],
  [ 2,  0,  0, -2,  0,      48.0,    0.0,      1.0,    0.0],
  [ 0,  0,  2, -2,  0,     -22.0,    0.0,      0.0,    0.0],
  [ 0,  2,  0,  0,  0,      17.0,   -0.1,      0.0,    0.0],
  [ 0,  1,  0,  0,  1,     -15.0,    0.0,      9.0,    0.0],
  [ 0,  2,  2, -2,  2,     -16.0,    0.1,      7.0,    0.0],
  [ 0, -1,  0,  0,  1,     -12.0,    0.0,      6.0,    0.0],
  [-2,  0,  0,  2,  1,      -6.0,    0.0,      3.0,    0.0],
  [ 0, -1,  2, -2,  1,      -5.0,    0.0,      3.0,    0.0],
  [ 2,  0,  0, -2,  1,       4.0,    0.0,     -2.0,    0.0],
  [ 0,  1,  2, -2,  1,       4.0,    0.0,     -2.0,    0.0],
  [ 1,  0,  0, -1,  0,      -4.0,    0.0,      0.0,    0.0],
  [ 2,  1,  0, -2,  0,       1.0,    0.0,      0.0,    0.0],
  [ 0,  0, -2,  2,  1,       1.0,    0.0,      0.0,    0.0],
  [ 0,  1, -2,  2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  1,  0,  0,  2,       1.0,    0.0,      0.0,    0.0],
  [-1,  0,  0,  1,  1,       1.0,    0.0,      0.0,    0.0],
  [ 0,  1,  2, -2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  0,  2,  0,  2,   -2274.0,   -0.2,    977.0,   -0.5],
  [ 1,  0,  0,  0,  0,     712.0,    0.1,     -7.0,    0.0],
  [ 0,  0,  2,  0,  1,    -386.0,   -0.4,    200.0,    0.0],
  [ 1,  0,  2,  0,  2,    -301.0,    0.0,    129.0,   -0.1],
  [ 1,  0,  0, -2,  0,    -158.0,    0.0,     -1.0,    0.0],
  [-1,  0,  2,  0,  2,     123.0,    0.0,    -53.0,    0.0],
  [ 0,  0,  0,  2,  0,      63.0,    0.0,     -2.0,    0.0],
  [ 1,  0,  0,  0,  1,      63.0,    0.1,    -33.0,    0.0],
  [-1,  0,  0,  0,  1,     -58.0,   -0.1,     32.0,    0.0],
  [-1,  0,  2,  2,  2,     -59.0,    0.0,     26.0,    0.0],
  [ 1,  0,  2,  0,  1,     -51.0,    0.0,     27.0,    0.0],
  [ 0,  0,  2,  2,  2,     -38.0,    0.0,     16.0,    0.0],
  [ 2,  0,  0,  0,  0,      29.0,    0.0,     -1.0,    0.0],
  [ 1,  0,  2, -2,  2,      29.0,    0.0,    -12.0,    0.0],
  [ 2,  0,  2,  0,  2,     -31.0,    0.0,     13.0,    0.0],
  [ 0,  0,  2,  0,  0,      26.0,    0.0,     -1.0,    0.0],
  [-1,  0,  2,  0,  1,      21.0,    0.0,    -10.0,    0.0],
  [-1,  0,  0,  2,  1,      16.0,    0.0,     -8.0,    0.0],
  [ 1,  0,  0, -2,  1,     -13.0,    0.0,      7.0,    0.0],
  [-1,  0,  2,  2,  1,     -10.0,    0.0,      5.0,    0.0],
  [ 1,  1,  0, -2,  0,      -7.0,    0.0,      0.0,    0.0],
  [ 0,  1,  2,  0,  2,       7.0,    0.0,     -3.0,    0.0],
  [ 0, -1,  2,  0,  2,      -7.0,    0.0,      3.0,    0.0],
  [ 1,  0,  2,  2,  2,      -8.0,    0.0,      3.0,    0.0],
  [ 1,  0,  0,  2,  0,       6.0,    0.0,      0.0,    0.0],
  [ 2,  0,  2, -2,  2,       6.0,    0.0,     -3.0,    0.0],
  [ 0,  0,  0,  2,  1,      -6.0,    0.0,      3.0,    0.0],
  [ 0,  0,  2,  2,  1,      -7.0,    0.0,      3.0,    0.0],
  [ 1,  0,  2, -2,  1,       6.0,    0.0,     -3.0,    0.0],
  [ 0,  0,  0, -2,  1,      -5.0,    0.0,      3.0,    0.0],
  [ 1, -1,  0,  0,  0,       5.0,    0.0,      0.0,    0.0],
  [ 2,  0,  2,  0,  1,      -5.0,    0.0,      3.0,    0.0],
  [ 0,  1,  0, -2,  0,      -4.0,    0.0,      0.0,    0.0],
  [ 1,  0, -2,  0,  0,       4.0,    0.0,      0.0,    0.0],
  [ 0,  0,  0,  1,  0,      -4.0,    0.0,      0.0,    0.0],
  [ 1,  1,  0,  0,  0,      -3.0,    0.0,      0.0,    0.0],
  [ 1,  0,  2,  0,  0,       3.0,    0.0,      0.0,    0.0],
  [ 1, -1,  2,  0,  2,      -3.0,    0.0,      1.0,    0.0],
  [-1, -1,  2,  2,  2,      -3.0,    0.0,      1.0,    0.0],
  [-2,  0,  0,  0,  1,      -2.0,    0.0,      1.0,    0.0],
  [ 3,  0,  2,  0,  2,      -3.0,    0.0,      1.0,    0.0],
  [ 0, -1,  2,  2,  2,      -3.0,    0.0,      1.0,    0.0],
  [ 1,  1,  2,  0,  2,       2.0,    0.0,     -1.0,    0.0],
  [-1,  0,  2, -2,  1,      -2.0,    0.0,      1.0,    0.0],
  [ 2,  0,  0,  0,  1,       2.0,    0.0,     -1.0,    0.0],
  [ 1,  0,  0,  0,  2,      -2.0,    0.0,      1.0,    0.0],
  [ 3,  0,  0,  0,  0,       2.0,    0.0,      0.0,    0.0],
  [ 0,  0,  2,  1,  2,       2.0,    0.0,     -1.0,    0.0],
  [-1,  0,  0,  0,  2,       1.0,    0.0,     -1.0,    0.0],
  [ 1,  0,  0, -4,  0,      -1.0,    0.0,      0.0,    0.0],
  [-2,  0,  2,  2,  2,       1.0,    0.0,     -1.0,    0.0],
  [-1,  0,  2,  4,  2,      -2.0,    0.0,      1.0,    0.0],
  [ 2,  0,  0, -4,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 1,  1,  2, -2,  2,       1.0,    0.0,     -1.0,    0.0],
  [ 1,  0,  2,  2,  1,      -1.0,    0.0,      1.0,    0.0],
  [-2,  0,  2,  4,  2,      -1.0,    0.0,      1.0,    0.0],
  [-1,  0,  4,  0,  2,       1.0,    0.0,      0.0,    0.0],
  [ 1, -1,  0, -2,  0,       1.0,    0.0,      0.0,    0.0],
  [ 2,  0,  2, -2,  1,       1.0,    0.0,     -1.0,    0.0],
  [ 2,  0,  2,  2,  2,      -1.0,    0.0,      0.0,    0.0],
  [ 1,  0,  0,  2,  1,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  0,  4, -2,  2,       1.0,    0.0,      0.0,    0.0],
  [ 3,  0,  2, -2,  2,       1.0,    0.0,      0.0,    0.0],
  [ 1,  0,  2, -2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  1,  2,  0,  1,       1.0,    0.0,      0.0,    0.0],
  [-1, -1,  0,  2,  1,       1.0,    0.0,      0.0,    0.0],
  [ 0,  0, -2,  0,  1,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  0,  2, -1,  2,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  1,  0,  2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 1,  0, -2, -2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 0, -1,  2,  0,  1,      -1.0,    0.0,      0.0,    0.0],
  [ 1,  1,  0, -2,  1,      -1.0,    0.0,      0.0,    0.0],
  [ 1,  0, -2,  2,  0,      -1.0,    0.0,      0.0,    0.0],
  [ 2,  0,  0,  2,  0,       1.0,    0.0,      0.0,    0.0],
  [ 0,  0,  2,  4,  2,      -1.0,    0.0,      0.0,    0.0],
  [ 0,  1,  0,  1,  0,       1.0,    0.0,      0.0,    0.0],
];

const TERMS: readonly NutTerm[] = RAW.map((r) => ({
  l: r[0],
  lp: r[1],
  f: r[2],
  d: r[3],
  om: r[4],
  sp: r[5],
  spt: r[6],
  ce: r[7],
  cet: r[8],
}));

export interface NutationResult {
  /** Nutation in longitude (rad), including any ddpsi correction. */
  readonly deltapsi: number;
  /** Nutation in obliquity (rad), including any ddeps correction. */
  readonly deltaeps: number;
  /** Mean obliquity of the ecliptic (rad). */
  readonly meaneps: number;
  /** True obliquity = meaneps + deltaeps (rad). */
  readonly trueeps: number;
  /** True-Of-Date to Mean-Of-Date rotation: r_MOD = nut * r_TOD. */
  readonly nut: Mat3;
}

/** Reduce an angle (radians) to [0, 2pi). */
function rev(x: number): number {
  const r = x % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * Mean obliquity of the ecliptic (IAU-1980), radians:
 *   meaneps = 84381.448" - 46.8150" T - 0.00059" T^2 + 0.001813" T^3.
 */
export function meanObliquity(ttt: number): number {
  const ttt2 = ttt * ttt;
  const ttt3 = ttt2 * ttt;
  return (84381.448 - 46.8150 * ttt - 0.00059 * ttt2 + 0.001813 * ttt3) * ARCSEC;
}

/**
 * The five Delaunay fundamental arguments (radians, reduced to [0, 2pi)) at TT Julian
 * centuries ttt, per the IAU-1980 (FK5) series as given by Vallado. Returned in the
 * order [l, l', F, D, Omega].
 */
function delaunay(ttt: number): [number, number, number, number, number] {
  const ttt2 = ttt * ttt;
  const ttt3 = ttt2 * ttt;
  // Coefficients carry leading whole revolutions; we add (n rev) * 360 deg before the
  // arcsecond polynomial, exactly as Vallado tabulates them.
  // Mean anomaly of the Moon.
  const lDeg =
    134.96298139 +
    (1325.0 * 360.0 + 198.8673981) * ttt +
    0.0086972 * ttt2 +
    1.78e-5 * ttt3;
  // Mean anomaly of the Sun.
  const lpDeg =
    357.52772333 +
    (99.0 * 360.0 + 359.0503400) * ttt -
    0.0001603 * ttt2 -
    3.3e-6 * ttt3;
  // Mean argument of latitude of the Moon (F = L - Omega).
  const fDeg =
    93.27191028 +
    (1342.0 * 360.0 + 82.0175381) * ttt -
    0.0036825 * ttt2 +
    3.1e-6 * ttt3;
  // Mean elongation of the Moon from the Sun.
  const dDeg =
    297.85036306 +
    (1236.0 * 360.0 + 307.1114800) * ttt -
    0.0019142 * ttt2 +
    5.3e-6 * ttt3;
  // Mean longitude of the ascending node of the Moon.
  const omDeg =
    125.04452222 -
    (5.0 * 360.0 + 134.1362608) * ttt +
    0.0020708 * ttt2 +
    2.2e-6 * ttt3;
  return [
    rev(lDeg * DEG2RAD),
    rev(lpDeg * DEG2RAD),
    rev(fDeg * DEG2RAD),
    rev(dDeg * DEG2RAD),
    rev(omDeg * DEG2RAD),
  ];
}

/**
 * IAU-1980 nutation. Sums the full 106-term series, applies the optional celestial-pole
 * offsets ddpsi/ddeps (radians), and assembles the TOD -> MOD matrix.
 */
export function nutation(ttt: number, ddpsi = 0, ddeps = 0): NutationResult {
  if (!Number.isFinite(ttt) || !Number.isFinite(ddpsi) || !Number.isFinite(ddeps)) {
    throw new RangeError(`nutation: non-finite input (ttt=${ttt}, ddpsi=${ddpsi}, ddeps=${ddeps})`);
  }
  const [l, lp, f, d, om] = delaunay(ttt);

  let deltapsi = 0;
  let deltaeps = 0;
  // Sum smallest-to-largest (reverse order) for numerical hygiene, as ERFA/SOFA do.
  for (let i = TERMS.length - 1; i >= 0; i--) {
    const t = TERMS[i]!;
    const arg = t.l * l + t.lp * lp + t.f * f + t.d * d + t.om * om;
    const sinArg = Math.sin(arg);
    const cosArg = Math.cos(arg);
    deltapsi += (t.sp + t.spt * ttt) * U * sinArg;
    deltaeps += (t.ce + t.cet * ttt) * U * cosArg;
  }

  deltapsi += ddpsi;
  deltaeps += ddeps;

  const meaneps = meanObliquity(ttt);
  const trueeps = meaneps + deltaeps;

  // r_MOD = ROT1(-meaneps) ROT3(deltapsi) ROT1(trueeps) r_TOD (Vallado nutation matrix).
  const nut = mul(rot1(-meaneps), mul(rot3(deltapsi), rot1(trueeps)));

  return { deltapsi, deltaeps, meaneps, trueeps, nut };
}

/** The number of nutation terms summed (the full IAU-1980 series). */
export const NUTATION_TERM_COUNT = TERMS.length;
