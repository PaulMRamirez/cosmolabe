// linalg unit tests: matmul/transpose identities, and the central guarantee that an
// inverse times its matrix is the identity (both the SPD Cholesky inverse and the
// general Gaussian solve), so the estimators' normal-equation and covariance math rests
// on a verified base.

import { describe, expect, it } from 'vitest';
import {
  cholSolve,
  gaussSolve,
  identity,
  isPositiveDefinite,
  mat,
  matmul,
  symInverse,
  transpose,
  type Mat,
} from './linalg.ts';
import { SingularMatrixError } from './errors.ts';

function maxAbsDiff(a: Mat, b: Mat): number {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i]! - b.data[i]!));
  return m;
}

describe('linalg', () => {
  it('matmul against a hand-computed product', () => {
    const a = mat(2, 3, Float64Array.of(1, 2, 3, 4, 5, 6));
    const b = mat(3, 2, Float64Array.of(7, 8, 9, 10, 11, 12));
    const c = matmul(a, b);
    // [1*7+2*9+3*11, 1*8+2*10+3*12; 4*7+5*9+6*11, 4*8+5*10+6*12] = [58, 64; 139, 154]
    expect(Array.from(c.data)).toEqual([58, 64, 139, 154]);
  });

  it('transpose round-trips', () => {
    const a = mat(2, 3, Float64Array.of(1, 2, 3, 4, 5, 6));
    expect(maxAbsDiff(transpose(transpose(a)), a)).toBe(0);
  });

  it('symInverse * A = I for an SPD matrix', () => {
    // A symmetric positive-definite 6x6: M = B^T B + 6 I for a random-ish B.
    const b = mat(6, 6, Float64Array.from({ length: 36 }, (_, i) => Math.sin(i * 1.7) + 0.1 * i));
    const m = matmul(transpose(b), b);
    for (let i = 0; i < 6; i++) m.data[i * 6 + i]! += 6;
    const inv = symInverse(m);
    const prod = matmul(inv, m);
    expect(maxAbsDiff(prod, identity(6))).toBeLessThan(1e-9);
  });

  it('cholSolve solves A x = b consistently with the inverse', () => {
    const b = mat(4, 4, Float64Array.from({ length: 16 }, (_, i) => Math.cos(i * 0.9)));
    const m = matmul(transpose(b), b);
    for (let i = 0; i < 4; i++) m.data[i * 4 + i]! += 4;
    const rhs = Float64Array.of(1, -2, 3, 0.5);
    const x = cholSolve(m, rhs);
    const back = matmul(m, mat(4, 1, x));
    for (let i = 0; i < 4; i++) expect(back.data[i]!).toBeCloseTo(rhs[i]!, 9);
  });

  it('gaussSolve matches a known solution', () => {
    // 2x + y = 5; x + 3y = 10 => x = 1, y = 3.
    const a = mat(2, 2, Float64Array.of(2, 1, 1, 3));
    const x = gaussSolve(a, Float64Array.of(5, 10));
    expect(x[0]!).toBeCloseTo(1, 12);
    expect(x[1]!).toBeCloseTo(3, 12);
  });

  it('gaussSolve throws on a singular matrix', () => {
    const a = mat(2, 2, Float64Array.of(1, 2, 2, 4)); // rank 1
    expect(() => gaussSolve(a, Float64Array.of(1, 2))).toThrow(SingularMatrixError);
  });

  it('gaussSolve rejects a rank-deficient system by a SCALED (relative) pivot threshold', () => {
    // A large-scale EXACTLY rank-deficient matrix: row 2 is a scalar multiple of row 1, so after
    // elimination the second pivot collapses to ~0 relative to the 1e6 row scale. The old absolute
    // 1e-300 floor would accept it (the pivot is not exactly zero in floating point) and return a
    // garbage solution with an over-optimistic covariance; the scaled relative criterion catches
    // the collapsed direction and throws.
    const big = 1e6;
    const a = mat(2, 2, Float64Array.of(big, 2 * big, 3 * big, 6 * big)); // row2 = 3 * row1: rank 1
    expect(() => gaussSolve(a, Float64Array.of(big, 3 * big))).toThrow(SingularMatrixError);
    // A badly conditioned but FULL-RANK system at the same large scale still solves (the scaled
    // pivot stays a few times epsilon, above the rounding floor), so we do not over-reject.
    const cond = mat(2, 2, Float64Array.of(big, big, big, big + 1)); // pivot ~1/1e6 ~ 1e-6 ratio
    const xc = gaussSolve(cond, Float64Array.of(2 * big + 1, 2 * big + 1));
    expect(xc[0]!).toBeCloseTo(2, 4);
    expect(xc[1]!).toBeCloseTo(0, 4);
    // A plainly well-conditioned matrix at the same scale solves exactly.
    const ok = mat(2, 2, Float64Array.of(big, 0, 0, big));
    const x = gaussSolve(ok, Float64Array.of(big, 2 * big));
    expect(x[0]!).toBeCloseTo(1, 9);
    expect(x[1]!).toBeCloseTo(2, 9);
  });

  it('isPositiveDefinite distinguishes SPD from indefinite', () => {
    expect(isPositiveDefinite(mat(2, 2, Float64Array.of(2, 0, 0, 3)))).toBe(true);
    expect(isPositiveDefinite(mat(2, 2, Float64Array.of(1, 2, 2, 1)))).toBe(false);
  });
});
