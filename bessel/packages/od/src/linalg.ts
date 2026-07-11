// Tiny dense linear algebra for orbit determination: row-major Float64Array matrices of
// modest size (up to 6x6 square systems, and Nx6 measurement Jacobians). Just enough to
// assemble and solve the normal equations and to propagate covariance. No BLAS, no
// dependencies; every routine is allocation-light and explicit. Symmetric inverse goes
// through Cholesky (covariances and normal matrices are symmetric positive definite);
// a general solve uses Gaussian elimination with partial pivoting.
// (Tapley-Schutz-Born §5.2; Golub-Van Loan for Cholesky.)

import { SingularMatrixError } from './errors.ts';

/** A row-major dense matrix: `rows` x `cols`, `data` length rows*cols. */
export interface Mat {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
}

export function mat(rows: number, cols: number, data?: Float64Array): Mat {
  return { rows, cols, data: data ?? new Float64Array(rows * cols) };
}

/** The rows x rows identity. */
export function identity(n: number): Mat {
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) d[i * n + i] = 1;
  return { rows: n, cols: n, data: d };
}

/** C = A * B. Throws on a shape mismatch. */
export function matmul(a: Mat, b: Mat): Mat {
  if (a.cols !== b.rows) throw new SingularMatrixError(`matmul shape mismatch: ${a.rows}x${a.cols} * ${b.rows}x${b.cols}`);
  const out = new Float64Array(a.rows * b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k]!;
      if (aik === 0) continue;
      for (let j = 0; j < b.cols; j++) {
        out[i * b.cols + j]! += aik * b.data[k * b.cols + j]!;
      }
    }
  }
  return { rows: a.rows, cols: b.cols, data: out };
}

/** A^T. */
export function transpose(a: Mat): Mat {
  const out = new Float64Array(a.rows * a.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) {
      out[j * a.rows + i] = a.data[i * a.cols + j]!;
    }
  }
  return { rows: a.cols, cols: a.rows, data: out };
}

/** C = A + B (same shape). */
export function add(a: Mat, b: Mat): Mat {
  if (a.rows !== b.rows || a.cols !== b.cols) throw new SingularMatrixError('add shape mismatch');
  const out = new Float64Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i]! + b.data[i]!;
  return { rows: a.rows, cols: a.cols, data: out };
}

/** C = A - B (same shape). */
export function sub(a: Mat, b: Mat): Mat {
  if (a.rows !== b.rows || a.cols !== b.cols) throw new SingularMatrixError('sub shape mismatch');
  const out = new Float64Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i]! - b.data[i]!;
  return { rows: a.rows, cols: a.cols, data: out };
}

/** y = A * x (x a plain vector of length A.cols). */
export function matVec(a: Mat, x: ArrayLike<number>): Float64Array {
  if (x.length !== a.cols) throw new SingularMatrixError(`matVec shape mismatch: ${a.rows}x${a.cols} * ${x.length}`);
  const out = new Float64Array(a.rows);
  for (let i = 0; i < a.rows; i++) {
    let acc = 0;
    for (let j = 0; j < a.cols; j++) acc += a.data[i * a.cols + j]! * x[j]!;
    out[i] = acc;
  }
  return out;
}

/** Half the symmetric part, (A + A^T)/2, to scrub asymmetry that creeps in numerically. */
export function symmetrize(a: Mat): Mat {
  if (a.rows !== a.cols) throw new SingularMatrixError('symmetrize needs a square matrix');
  const n = a.rows;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[i * n + j] = 0.5 * (a.data[i * n + j]! + a.data[j * n + i]!);
    }
  }
  return { rows: n, cols: n, data: out };
}

/**
 * Cholesky factor L (lower triangular, row-major) of a symmetric positive-definite A,
 * A = L L^T. Throws SingularMatrixError if a pivot is non-positive (A not SPD).
 */
export function cholesky(a: Mat): Mat {
  if (a.rows !== a.cols) throw new SingularMatrixError('cholesky needs a square matrix');
  const n = a.rows;
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a.data[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (sum <= 0) throw new SingularMatrixError(`cholesky: non-positive pivot ${sum} at index ${i} (matrix not positive definite)`);
        l[i * n + j] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j]!;
      }
    }
  }
  return { rows: n, cols: n, data: l };
}

/** Solve A x = b for SPD A via its Cholesky factor (forward then back substitution). */
export function cholSolve(a: Mat, b: ArrayLike<number>): Float64Array {
  const n = a.rows;
  if (b.length !== n) throw new SingularMatrixError('cholSolve shape mismatch');
  const l = cholesky(a).data;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i * n + k]! * y[k]!;
    y[i] = sum / l[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * x[k]!;
    x[i] = sum / l[i * n + i]!;
  }
  return x;
}

/** Inverse of an SPD matrix via Cholesky (solve against each identity column). */
export function symInverse(a: Mat): Mat {
  const n = a.rows;
  const l = cholesky(a).data; // factor once, reuse for every column
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    e.fill(0);
    e[c] = 1;
    // forward solve L y = e
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = e[i]!;
      for (let k = 0; k < i; k++) sum -= l[i * n + k]! * y[k]!;
      y[i] = sum / l[i * n + i]!;
    }
    // back solve L^T x = y
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i]!;
      for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * inv[k * n + c]!;
      inv[i * n + c] = sum / l[i * n + i]!;
    }
  }
  return { rows: n, cols: n, data: inv };
}

/**
 * General dense solve A x = b by Gaussian elimination with SCALED partial pivoting. Used for the
 * normal equations where assembling an SPD guarantee is awkward; throws SingularMatrixError on a
 * pivot that is negligible relative to its row's scale (a rank-deficient direction). The old
 * absolute floor (1e-300) accepted a near-singular pivot and returned a garbage step with an
 * over-optimistic covariance; the scaled criterion compares each pivot to the magnitude of the
 * data in its own row, so a badly conditioned but full-rank system (a uniformly large normal
 * matrix) still solves while a collapsed (rank-deficient) row is rejected.
 */
export function gaussSolve(a: Mat, b: ArrayLike<number>): Float64Array {
  const n = a.rows;
  if (a.cols !== n) throw new SingularMatrixError('gaussSolve needs a square matrix');
  if (b.length !== n) throw new SingularMatrixError('gaussSolve shape mismatch');
  // Augmented copy [A | b].
  const m = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m[i * (n + 1) + j] = a.data[i * n + j]!;
    m[i * (n + 1) + n] = b[i]!;
  }
  // Per-row scale: the largest magnitude in each original row of A. The singularity test compares
  // a pivot to the scale of the row it came from (scaled / implicit pivoting), which is invariant
  // to the overall magnitude of the system and so rejects only a genuinely rank-deficient row, not
  // a uniformly ill-scaled but full-rank one.
  const rowScale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      const v = Math.abs(a.data[i * n + j]!);
      if (v > s) s = v;
    }
    rowScale[i] = s;
  }
  for (let col = 0; col < n; col++) {
    // Scaled partial pivot: choose the row maximizing |pivot| / rowScale among rows at or below the
    // diagonal, so the pivot is the most significant relative to its own row's magnitude.
    let piv = col;
    let bestRatio = -1;
    for (let r = col; r < n; r++) {
      const s = rowScale[r]! || 1;
      const ratio = Math.abs(m[r * (n + 1) + col]!) / s;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        piv = r;
      }
    }
    // Reject when the best available pivot is negligible relative to its row scale: that column has
    // no significant entry left, i.e. the system is rank-deficient (under-observed) to working
    // precision. The floor is a small fraction of machine epsilon so a genuinely collapsed
    // direction (scaled ratio at the rounding floor) is caught, while a merely badly conditioned
    // but full-rank iterate (scaled ratio a few times epsilon) still solves and is left for the
    // caller's own divergence/condition handling.
    const SINGULAR_RATIO = Number.EPSILON / 4;
    if (bestRatio <= SINGULAR_RATIO) {
      throw new SingularMatrixError(
        `gaussSolve: rank-deficient at column ${col} (scaled pivot ratio ${bestRatio} <= ${SINGULAR_RATIO})`,
      );
    }
    if (piv !== col) {
      const ts = rowScale[col]!;
      rowScale[col] = rowScale[piv]!;
      rowScale[piv] = ts;
      for (let j = 0; j <= n; j++) {
        const tmp = m[col * (n + 1) + j]!;
        m[col * (n + 1) + j] = m[piv * (n + 1) + j]!;
        m[piv * (n + 1) + j] = tmp;
      }
    }
    const pivot = m[col * (n + 1) + col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r * (n + 1) + col]! / pivot;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[r * (n + 1) + j]! -= factor * m[col * (n + 1) + j]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = m[i * (n + 1) + n]! / m[i * (n + 1) + i]!;
  return x;
}

/** True iff every Cholesky pivot is positive, i.e. A is symmetric positive definite. */
export function isPositiveDefinite(a: Mat): boolean {
  try {
    cholesky(symmetrize(a));
    return true;
  } catch {
    return false;
  }
}
