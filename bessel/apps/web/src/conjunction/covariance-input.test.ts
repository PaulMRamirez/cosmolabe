import { describe, it, expect } from 'vitest';
import {
  diagonalCovariance,
  buildSuppliedCovariance,
  suppliedEncounterPc,
  CovarianceInputError,
} from './covariance-input.ts';

// The supplied-covariance path is pure: building an inertial 3x3 from the analyst input (with the
// RTN rotation and the positive-definite gate) and the covariance-input -> 2x2 encounter projection
// -> Pc chain are unit-tested directly, including the non-positive-definite loud-fail.

describe('diagonalCovariance', () => {
  it('builds diag(sigma^2) from three per-axis sigmas', () => {
    expect(diagonalCovariance(2, 3, 4)).toEqual([4, 0, 0, 0, 9, 0, 0, 0, 16]);
  });

  it('throws loud on a non-positive sigma', () => {
    expect(() => diagonalCovariance(0, 1, 1)).toThrow(CovarianceInputError);
    expect(() => diagonalCovariance(1, -1, 1)).toThrow(/positive/);
  });
});

describe('buildSuppliedCovariance', () => {
  const state6 = [7000, 0, 0, 0, 7.5, 0]; // circular-ish state along +x with +y velocity

  it('passes an inertial diagonal covariance through unchanged', () => {
    const built = buildSuppliedCovariance({ matrix3: [1, 0, 0, 0, 4, 0, 0, 0, 9], frame: 'inertial' }, state6);
    expect([...built.posCov3]).toEqual([1, 0, 0, 0, 4, 0, 0, 0, 9]);
  });

  it('rotates an RTN diagonal covariance into the inertial frame (R->+x, T->+y, N->+z here)', () => {
    // For state (r along +x, v along +y): R = +x, N = +z, T = N x R = +y. So the RTN axes map to
    // the inertial axes (x,y,z), and a diagonal RTN covariance stays diagonal with the same values.
    const built = buildSuppliedCovariance({ matrix3: diagonalCovariance(1, 2, 3), frame: 'rtn' }, state6);
    expect(built.posCov3[0]).toBeCloseTo(1, 9); // R^2 -> x
    expect(built.posCov3[4]).toBeCloseTo(4, 9); // T^2 -> y
    expect(built.posCov3[8]).toBeCloseTo(9, 9); // N^2 -> z
    // Off-diagonals are ~0 (axis-aligned mapping).
    expect(built.posCov3[1]).toBeCloseTo(0, 9);
  });

  it('preserves the covariance trace under the RTN rotation (orthogonal transform)', () => {
    const tilted = [4, 1, 0, 1, 2, 0, 0, 0, 3];
    const built = buildSuppliedCovariance({ matrix3: tilted, frame: 'rtn' }, [3000, 4000, 1000, 1, 2, 7]);
    const trIn = tilted[0]! + tilted[4]! + tilted[8]!;
    const trOut = built.posCov3[0]! + built.posCov3[4]! + built.posCov3[8]!;
    expect(trOut).toBeCloseTo(trIn, 9);
  });

  it('throws loud on a non-symmetric matrix', () => {
    expect(() => buildSuppliedCovariance({ matrix3: [1, 2, 0, 9, 1, 0, 0, 0, 1], frame: 'inertial' }, state6)).toThrow(
      /symmetric/,
    );
  });

  it('throws loud on a non-positive-definite matrix', () => {
    // Symmetric but indefinite (a negative eigenvalue): det of the full 3x3 is negative.
    expect(() =>
      buildSuppliedCovariance({ matrix3: [1, 2, 0, 2, 1, 0, 0, 0, 1], frame: 'inertial' }, state6),
    ).toThrow(/positive-definite/);
  });
});

describe('suppliedEncounterPc (covariance-input -> 2x2 encounter projection -> Pc)', () => {
  // A head-on encounter: primary at the origin, secondary offset cross-track with opposing velocity.
  const primaryState = [0, 0, 0, 0, 7.5, 0];
  const secondaryState = [0.5, 0, 0, 0, -7.5, 0]; // 0.5 km cross-track miss, relative velocity along y
  const cov = [0.04, 0, 0, 0, 0.04, 0, 0, 0, 0.04]; // 0.2 km isotropic position sigma per object

  it('returns a finite Pc in [0,1] with a sane 2x2 projection and miss', () => {
    const r = suppliedEncounterPc(primaryState, cov, secondaryState, cov, 0.02);
    expect(r.pc).toBeGreaterThan(0);
    expect(r.pc).toBeLessThan(1);
    expect(r.missKm).toBeCloseTo(0.5, 6);
    expect(r.relSpeedKmS).toBeCloseTo(15, 6);
    // The combined in-plane covariance variances are positive.
    expect(r.cxx).toBeGreaterThan(0);
    expect(r.cyy).toBeGreaterThan(0);
  });

  it('grows the Pc as the supplied covariance grows (larger uncertainty -> larger Pc near a small miss)', () => {
    const tight = suppliedEncounterPc(primaryState, [1e-4, 0, 0, 0, 1e-4, 0, 0, 0, 1e-4], secondaryState, [1e-4, 0, 0, 0, 1e-4, 0, 0, 0, 1e-4], 0.02);
    const loose = suppliedEncounterPc(primaryState, cov, secondaryState, cov, 0.02);
    expect(loose.pc).toBeGreaterThan(tight.pc);
  });

  it('throws loud (non-positive-definite) when a combined covariance is degenerate for Pc', () => {
    // A zero secondary covariance and a zero primary covariance -> a singular combined covariance.
    const zero = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(() => suppliedEncounterPc(primaryState, zero, secondaryState, zero, 0.02)).toThrow();
  });

  it('throws loud on a negative hard-body radius', () => {
    expect(() => suppliedEncounterPc(primaryState, cov, secondaryState, cov, -1)).toThrow(CovarianceInputError);
  });
});
