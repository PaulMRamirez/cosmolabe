// Tests for the EOP-aware TEME -> J2000 transform and its precession/nutation building
// blocks. The PRIMARY absolute-correctness oracle is Vallado, Crawford, Hujsak & Kelso,
// "Revisiting Spacetrack Report #3" (AIAA 2006-6753, Rev. 3), Appendix C, eq. (C-2/C-3):
// the worked TEME -> J2000 ("of date", IAU-76/FK5) example at day 182.784 950 62 of year
// 2000 (TLE 00005 epoch 00179.784 950 62 propagated 3 days). The remaining oracles are
// self-consistency checks (orthonormality, round-trip, magnitude, obliquity).
// Source: https://celestrak.org/publications/AIAA/2006-6753/AIAA-2006-6753-Rev3.pdf
// (STK_PARITY_SPEC frames.)

import { describe, it, expect } from 'vitest';
import {
  temeToJ2000,
  temeToJ2000Matrix,
  temeToJ2000AtEt,
  j2000ToTeme,
  precession,
  nutation,
  meanObliquity,
  NUTATION_TERM_COUNT,
  type EarthOrientation,
} from './index.ts';
import { mul, transpose, type Vec3 } from './mat3.ts';
import type { Mat3 } from '../force/types.ts';

const ARCSEC = Math.PI / (180 * 3600);

// TT Julian centuries past J2000 for the Vallado example epoch (day 182.784 950 62 of
// year 2000). Year-2000 day-of-year d gives JD_UTC = 2451544.5 + (d - 1); TT = UTC +
// (dAT 32 s + 32.184 s) = UTC + 64.184 s. TEME -> J2000 needs only TT, so UT1/polar
// motion are not used.
const JD_UTC = 2451544.5 + (182.78495062 - 1);
const JD_TT = JD_UTC + 64.184 / 86400;
const EXAMPLE_TTT = (JD_TT - 2451545.0) / 36525;

const TEME = {
  position: [-9060.47373569, 4658.70952502, 813.68673153] as [number, number, number],
  velocity: [-2.232832783, -4.11045349, -3.157345433] as [number, number, number],
};
// Published IAU-76/FK5 "J2000" result, eq. (C-3).
const J2000_R = [-9059.9415541, 4659.697199, 813.9569402];
const J2000_V = [-2.233347413, -4.110136158, -3.15739456];

function identityError(m: Mat3): number {
  const i = mul(transpose(m), m);
  const ident: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let e = 0;
  for (let k = 0; k < 9; k++) e = Math.max(e, Math.abs(i[k]! - ident[k]!));
  return e;
}

function det(m: Mat3): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

function norm(v: Vec3): number {
  return Math.hypot(v[0]!, v[1]!, v[2]!);
}

describe('TEME -> J2000 (Vallado AIAA 2006-6753 Appendix C oracle)', () => {
  it('reproduces the published J2000 position to sub-meter and velocity to ~1e-6 km/s', () => {
    const out = temeToJ2000(TEME, EXAMPLE_TTT);
    // x and y match to well under a meter; z to under a meter. The tiny residual is
    // dominated by the example's (unpublished, for this year-2000 date) celestial-pole
    // EOP corrections and the second-level time rounding, both immaterial here.
    expect(out.position[0]).toBeCloseTo(J2000_R[0]!, 3); // ~1e-4 km
    expect(out.position[1]).toBeCloseTo(J2000_R[1]!, 3);
    expect(Math.abs(out.position[2] - J2000_R[2]!)).toBeLessThan(1e-3); // < 1 m
    expect(out.velocity[0]).toBeCloseTo(J2000_V[0]!, 6);
    expect(out.velocity[1]).toBeCloseTo(J2000_V[1]!, 6);
    expect(out.velocity[2]).toBeCloseTo(J2000_V[2]!, 6);
  });

  it('reproduces the published transformation matrix structure (eq. C-2)', () => {
    const m = temeToJ2000Matrix(EXAMPLE_TTT);
    // Diagonal ~1, off-diagonals at the published 1e-4..1e-5 magnitudes.
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[4]).toBeCloseTo(1, 6);
    expect(m[8]).toBeCloseTo(1, 6);
    expect(Math.abs(m[1]!)).toBeCloseTo(0.000111, 5);
    expect(Math.abs(m[2]!)).toBeCloseTo(0.0000185, 5);
    expect(Math.abs(m[5]!)).toBeCloseTo(0.000022, 5);
  });

  it('the et convenience wrapper agrees with the explicit-ttt call', () => {
    const et = EXAMPLE_TTT * 86400 * 36525; // invert ttt = et / (86400 * 36525)
    const a = temeToJ2000AtEt(TEME, et);
    const b = temeToJ2000(TEME, EXAMPLE_TTT);
    for (let i = 0; i < 3; i++) {
      expect(a.position[i]).toBeCloseTo(b.position[i]!, 9);
      expect(a.velocity[i]).toBeCloseTo(b.velocity[i]!, 9);
    }
  });
});

describe('TEME -> J2000 self-consistency oracles', () => {
  const ttts = [-0.5, 0, 0.0049633, 0.1, 0.25];

  it('the matrix is orthonormal and proper (det = +1)', () => {
    for (const ttt of ttts) {
      const m = temeToJ2000Matrix(ttt, { ddpsi: 1e-7, ddeps: -2e-7 });
      expect(identityError(m)).toBeLessThan(1e-12);
      expect(det(m)).toBeCloseTo(1, 12);
    }
  });

  it('round-trips J2000 <- TEME <- J2000 to ~1e-9', () => {
    const eop: EarthOrientation = { ddpsi: 3e-7, ddeps: -1e-7 };
    for (const ttt of ttts) {
      const fwd = temeToJ2000(TEME, ttt, eop);
      const back = j2000ToTeme(fwd, ttt, eop);
      for (let i = 0; i < 3; i++) {
        expect(back.position[i]).toBeCloseTo(TEME.position[i]!, 9);
        expect(back.velocity[i]).toBeCloseTo(TEME.velocity[i]!, 9);
      }
    }
  });

  it('preserves vector magnitude (a rotation is an isometry)', () => {
    for (const ttt of ttts) {
      const out = temeToJ2000(TEME, ttt);
      expect(norm(out.position)).toBeCloseTo(norm(TEME.position), 9);
      expect(norm(out.velocity)).toBeCloseTo(norm(TEME.velocity), 9);
    }
  });

  it('applies a nonzero ddpsi/ddeps as a small, monotone shift', () => {
    const base = temeToJ2000(TEME, EXAMPLE_TTT);
    const ddpsi = 5e-6; // rad (~1 arcsec)
    const ddeps = -5e-6;
    const shifted = temeToJ2000(TEME, EXAMPLE_TTT, { ddpsi, ddeps });
    const d = Math.hypot(
      shifted.position[0] - base.position[0],
      shifted.position[1] - base.position[1],
      shifted.position[2] - base.position[2],
    );
    // A ~1 arcsec pole offset moves a ~9100 km vector by roughly |r| * angle (~0.04 km),
    // i.e. a small but clearly nonzero, sub-100 m effect.
    expect(d).toBeGreaterThan(1e-3);
    expect(d).toBeLessThan(0.2);
  });
});

describe('precession (IAU-1976)', () => {
  it('is exactly the identity at J2000 (ttt = 0)', () => {
    const p = precession(0);
    const ident: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let k = 0; k < 9; k++) expect(p[k]).toBeCloseTo(ident[k]!, 12);
  });

  it('is orthonormal and proper away from J2000', () => {
    for (const ttt of [-1, 0.0049633, 0.5, 1]) {
      const p = precession(ttt);
      expect(identityError(p)).toBeLessThan(1e-12);
      expect(det(p)).toBeCloseTo(1, 12);
    }
  });

  it('rejects a non-finite ttt', () => {
    expect(() => precession(Number.NaN)).toThrow(RangeError);
  });
});

describe('nutation (IAU-1980, full 106-term series)', () => {
  it('sums the complete 106-term series', () => {
    expect(NUTATION_TERM_COUNT).toBe(106);
  });

  it('mean obliquity at J2000 equals 84381.448 arcsec (0.4090928 rad)', () => {
    expect(meanObliquity(0)).toBeCloseTo(84381.448 * ARCSEC, 12);
    expect(meanObliquity(0)).toBeCloseTo(0.4090928042, 9);
  });

  it('nutation in longitude stays under 20 arcsec in magnitude', () => {
    for (const ttt of [-1, 0, 0.0049633, 0.5, 1]) {
      const n = nutation(ttt);
      expect(Math.abs(n.deltapsi) / ARCSEC).toBeLessThan(20);
      expect(Math.abs(n.deltaeps) / ARCSEC).toBeLessThan(20);
    }
  });

  it('matches the Vallado example nutation magnitudes (~ -15.4" psi, -4.5" eps)', () => {
    // Cross-check against the worked Appendix C epoch: the full series there yields a
    // deltapsi near -15.4 arcsec and deltaeps near -4.5 arcsec.
    const n = nutation(EXAMPLE_TTT);
    expect(n.deltapsi / ARCSEC).toBeCloseTo(-15.358, 1);
    expect(n.deltaeps / ARCSEC).toBeCloseTo(-4.533, 1);
  });

  it('adds the EOP corrections directly to deltapsi/deltaeps', () => {
    const base = nutation(EXAMPLE_TTT);
    const ddpsi = 1e-6;
    const ddeps = -2e-6;
    const corr = nutation(EXAMPLE_TTT, ddpsi, ddeps);
    expect(corr.deltapsi - base.deltapsi).toBeCloseTo(ddpsi, 12);
    expect(corr.deltaeps - base.deltaeps).toBeCloseTo(ddeps, 12);
    expect(corr.trueeps - base.trueeps).toBeCloseTo(ddeps, 12);
  });

  it('rejects non-finite inputs', () => {
    expect(() => nutation(Number.NaN)).toThrow(RangeError);
    expect(() => nutation(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
