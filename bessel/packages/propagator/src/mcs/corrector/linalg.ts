// Tiny dense linear algebra for the differential corrector. Systems are at most ~6x6, so
// plain Gaussian elimination with partial pivoting is both sufficient and exact enough; no
// external dependency. Three solve shapes: square (m == n), least-squares (m > n, normal
// equations), and minimum-norm (m < n, underdetermined). Matrices are row-major Float64.
// (STK_PARITY_SPEC §4.3.)

/**
 * Relative pivot floor for the singularity test. A pivot is singular not only when it is exactly
 * zero but when it is negligible against the largest magnitude in its (remaining) column: dividing
 * a tiny but non-zero pivot (e.g. 1e-300) through to the back-substitution silently produces an
 * Inf/NaN solution and never trips the exact-zero guard, so the catch-based solveMinNorm /
 * projectOntoNullSpace fallbacks never engage. Compare |pivot| to PIVOT_EPS * maxAbs(column).
 */
const PIVOT_EPS = 1e-14;

/** Solve A x = b for a square n x n A (partial pivoting). Returns x; throws on singularity. */
export function solveSquare(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const m = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r * n + col]!) > Math.abs(m[piv * n + col]!)) piv = r;
    // Relative singularity test: the pivot is the largest remaining entry in this column (partial
    // pivoting), so its magnitude already bounds maxAbs over rows col..n-1. Treat as singular when
    // it falls below PIVOT_EPS times the largest absolute entry anywhere in the working column.
    let colMax = 0;
    for (let r = 0; r < n; r++) colMax = Math.max(colMax, Math.abs(m[r * n + col]!));
    if (Math.abs(m[piv * n + col]!) <= PIVOT_EPS * colMax || colMax === 0) {
      throw new Error('singular matrix in solveSquare');
    }
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = m[piv * n + c]!;
        m[piv * n + c] = m[col * n + c]!;
        m[col * n + c] = tmp;
      }
      const tb = x[piv]!;
      x[piv] = x[col]!;
      x[col] = tb;
    }
    const d = m[col * n + col]!;
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col]! / d;
      for (let c = col; c < n; c++) m[r * n + c]! -= f * m[col * n + c]!;
      x[r]! -= f * x[col]!;
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let s = x[row]!;
    for (let c = row + 1; c < n; c++) s -= m[row * n + c]! * x[c]!;
    x[row] = s / m[row * n + row]!;
  }
  return x;
}

/** A^T A (n x n) and A^T b (n) for an m x n A. */
function normalEquations(A: Float64Array, b: Float64Array, m: number, n: number): { ata: Float64Array; atb: Float64Array } {
  const ata = new Float64Array(n * n);
  const atb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += A[k * n + i]! * A[k * n + j]!;
      ata[i * n + j] = s;
    }
    let sb = 0;
    for (let k = 0; k < m; k++) sb += A[k * n + i]! * b[k]!;
    atb[i] = sb;
  }
  return { ata, atb };
}

/**
 * Solve S x = b for a symmetric positive-definite n x n S via Cholesky (S = L L^T). The normal
 * matrices A^T A and A A^T are SPD by construction (and symmetric), so factoring them is both
 * cheaper and more numerically faithful than re-running general Gaussian elimination, which would
 * also discard the symmetry. A non-positive diagonal during the factorization means the matrix is
 * not positive-definite (rank-deficient or ill-conditioned): throw so the caller's catch-based
 * minimum-norm / null-space fallback engages, exactly as for a singular solveSquare.
 */
export function choleskySolve(S: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  // Scale the positive-definiteness floor to the matrix so a tiny-but-SPD or a large-but-singular
  // system is judged on relative, not absolute, footing.
  let diagMax = 0;
  for (let i = 0; i < n; i++) diagMax = Math.max(diagMax, Math.abs(S[i * n + i]!));
  const floor = PIVOT_EPS * Math.max(diagMax, 1e-300);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = S[i * n + j]!;
      for (let k = 0; k < j; k++) s -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (s <= floor) throw new Error('non-positive-definite matrix in choleskySolve');
        L[i * n + j] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j]!;
      }
    }
  }
  // Forward solve L y = b, then back solve L^T x = y.
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * n + k]! * y[k]!;
    y[i] = s / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k * n + i]! * x[k]!;
    x[i] = s / L[i * n + i]!;
  }
  return x;
}

/** Least-squares solve for an overdetermined system (m > n): (A^T A) x = A^T b. */
export function solveLeastSquares(A: Float64Array, b: Float64Array, m: number, n: number): Float64Array {
  const { ata, atb } = normalEquations(A, b, m, n);
  // A^T A is SPD when A has full column rank; prefer Cholesky and fall back to general elimination
  // only when the factorization rejects it (then solveSquare's relative pivot test throws cleanly).
  try {
    return choleskySolve(ata, atb, n);
  } catch {
    return solveSquare(ata, atb, n);
  }
}

/** Minimum-norm solve for an underdetermined system (m < n): x = A^T (A A^T)^-1 b. */
export function solveMinNorm(A: Float64Array, b: Float64Array, m: number, n: number): Float64Array {
  const aat = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += A[i * n + k]! * A[j * n + k]!;
      aat[i * m + j] = s;
    }
  }
  // (A A^T) y = b: A A^T is SPD when A has full row rank; prefer Cholesky, fall back on rejection.
  let y: Float64Array;
  try {
    y = choleskySolve(aat, b, m);
  } catch {
    y = solveSquare(aat, b, m);
  }
  const x = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += A[i * n + j]! * y[i]!;
    x[j] = s;
  }
  return x;
}

/** A pivot-ratio condition proxy for the square or normal system of an m x n A. */
export function conditionEstimate(A: Float64Array, m: number, n: number): number {
  const sq = m === n ? Float64Array.from(A) : normalEquations(A, new Float64Array(m), m, n).ata;
  const dim = n;
  const work = Float64Array.from(sq);
  let maxPiv = 0;
  let minPiv = Infinity;
  for (let col = 0; col < dim; col++) {
    let piv = col;
    for (let r = col + 1; r < dim; r++) if (Math.abs(work[r * dim + col]!) > Math.abs(work[piv * dim + col]!)) piv = r;
    const pv = Math.abs(work[piv * dim + col]!);
    if (pv === 0) return Infinity;
    maxPiv = Math.max(maxPiv, pv);
    minPiv = Math.min(minPiv, pv);
    if (piv !== col) for (let c = 0; c < dim; c++) {
      const tmp = work[piv * dim + c]!;
      work[piv * dim + c] = work[col * dim + c]!;
      work[col * dim + c] = tmp;
    }
    const d = work[col * dim + col]!;
    for (let r = col + 1; r < dim; r++) {
      const f = work[r * dim + col]! / d;
      for (let c = col; c < dim; c++) work[r * dim + c]! -= f * work[col * dim + c]!;
    }
  }
  return maxPiv / minPiv;
}
