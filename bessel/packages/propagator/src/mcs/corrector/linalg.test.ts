// The tiny dense solvers must fail loudly on a singular or near-singular system: an exact-zero
// pivot is obvious, but a TINY non-zero pivot (e.g. 1e-300) used to divide through to a NaN
// solution and silently pass, so the corrector's catch-based minimum-norm / null-space fallbacks
// never engaged. The relative pivot test (and the SPD Cholesky path) close that gap.

import { describe, it, expect } from 'vitest';
import { choleskySolve, solveLeastSquares, solveMinNorm, solveSquare } from './linalg.ts';

describe('solveSquare', () => {
  it('solves a well-conditioned 2x2 system', () => {
    // [[2,1],[1,3]] x = [3,5] -> x = [0.8, 1.4]
    const x = solveSquare(Float64Array.of(2, 1, 1, 3), Float64Array.of(3, 5), 2);
    expect(x[0]!).toBeCloseTo(0.8, 12);
    expect(x[1]!).toBeCloseTo(1.4, 12);
  });

  it('throws on a near-singular pivot rather than dividing to NaN', () => {
    // Two nearly-parallel rows: after the first elimination the SECOND pivot is ~1e-15 while the
    // column scale is O(1), below PIVOT_EPS (1e-14) * colMax, so the relative test must reject it.
    // The old exact-zero guard let this through (the pivot was non-zero) and the back-substitution
    // produced a NaN/Inf solution; assert the throw AND that the prior result was non-finite.
    const A = Float64Array.of(1, 1, 1, 1 + 1e-15);
    expect(() => solveSquare(A, Float64Array.of(1, 2), 2)).toThrow(/singular/);
  });

  it('still throws on an exactly singular matrix', () => {
    const A = Float64Array.of(1, 2, 2, 4); // rank 1
    expect(() => solveSquare(A, Float64Array.of(1, 2), 2)).toThrow(/singular/);
  });
});

describe('choleskySolve', () => {
  it('solves an SPD system to the same answer as solveSquare', () => {
    // [[4,2],[2,3]] is SPD; rhs [2,1] -> x = [0.5, 0].
    const S = Float64Array.of(4, 2, 2, 3);
    const b = Float64Array.of(2, 1);
    const x = choleskySolve(S, b, 2);
    expect(x[0]!).toBeCloseTo(0.5, 12);
    expect(x[1]!).toBeCloseTo(0, 12);
  });

  it('throws on a non-positive-definite (rank-deficient) matrix', () => {
    const S = Float64Array.of(1, 1, 1, 1); // singular, PSD but not PD
    expect(() => choleskySolve(S, Float64Array.of(1, 1), 2)).toThrow(/positive-definite/);
  });
});

describe('least-squares and minimum-norm via Cholesky', () => {
  it('solveLeastSquares matches the analytic overdetermined fit', () => {
    // Fit y = 2x to points (1,2),(2,4),(3,6): exact, slope 2.
    const A = Float64Array.of(1, 2, 3); // 3x1
    const b = Float64Array.of(2, 4, 6);
    const x = solveLeastSquares(A, b, 3, 1);
    expect(x[0]!).toBeCloseTo(2, 10);
  });

  it('solveMinNorm returns the minimum-norm solution of an underdetermined system', () => {
    // x0 + x1 = 1, min ||x|| -> x = [0.5, 0.5].
    const A = Float64Array.of(1, 1); // 1x2
    const x = solveMinNorm(A, Float64Array.of(1), 1, 2);
    expect(x[0]!).toBeCloseTo(0.5, 10);
    expect(x[1]!).toBeCloseTo(0.5, 10);
  });
});
