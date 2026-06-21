// Consider-parameter covariance augmentation for the batch estimator. Some error sources are
// known to be uncertain but are deliberately NOT estimated (a drag coefficient, a measurement
// range bias, a station-location offset): estimating them would be ill-conditioned or they are
// physically a nuisance. The estimate-only covariance Pxx = Lambda_xx^-1 then UNDERSTATES the
// true uncertainty, because it ignores the way those un-estimated "consider" parameters leak
// into the solution. The consider-covariance formula propagates their a-priori covariance Pcc
// through the estimator's own sensitivity to them.
//
// With the normal-equation blocks
//   Lambda_xx = sum Hx^T W Hx        (estimated-parameter information, 6x6)
//   Lambda_xc = sum Hx^T W Hc        (cross information, 6 x nc)
// the sensitivity of the solution to the consider parameters is
//   Sxc = -Pxx Lambda_xc            (6 x nc),     Pxx = Lambda_xx^-1
// and the consider covariance is the estimate covariance INFLATED by that leakage:
//   Pc  = Pxx + Sxc Pcc Sxc^T.
// Sxc Pcc Sxc^T is positive semidefinite (Pcc is a covariance), so Pc >= Pxx in the
// Loewner sense: the consider covariance can only grow the uncertainty, never shrink it.
// (Tapley-Schutz-Born §4.13, "consider covariance analysis"; Vallado §10.8.)

import { cholesky, mat, matmul, symInverse, symmetrize, transpose, type Mat } from './linalg.ts';
import { SingularMatrixError } from './errors.ts';

/**
 * The consider blocks the batch estimator accumulates: the cross information Lambda_xc and the
 * a-priori consider covariance Pcc. `nc` is the number of consider parameters.
 */
export interface ConsiderBlocks {
  /** sum Hx^T W Hc, row-major (6 x nc). */
  readonly crossInformation: Float64Array;
  /** A-priori consider covariance, row-major (nc x nc), symmetric positive semidefinite. */
  readonly considerCovariance: Float64Array;
  /** Number of consider parameters (>= 1). */
  readonly count: number;
}

/**
 * A measurement's consider sensitivity: the partial of the predicted observable with respect to
 * each consider parameter, mapped (like Hx) back to the solve epoch. Callers supply this so the
 * estimator stays agnostic to the parameter's physics.
 */
export interface ConsiderSensitivity {
  /**
   * dh/dp row-major (size x nc): rows are the measurement's scalar components in the order
   * `predict` returns them, columns are the consider parameters. For a range bias this is a
   * single 1 on the biased component; for a drag coefficient it is the STM-mapped sensitivity
   * of the observable to the drag parameter.
   */
  readonly partials: Float64Array;
}

/**
 * Compute the consider covariance Pc = Pxx + Sxc Pcc Sxc^T from the estimate information
 * Lambda_xx (6x6 row-major) and the consider blocks. Returns Pc (6x6 row-major). Throws via
 * symInverse if Lambda_xx is not SPD. The result is symmetric and, by construction, Pc >= Pxx.
 */
/**
 * Assert a symmetric matrix is positive semidefinite by Cholesky-factoring it with a tiny
 * diagonal jitter. The jitter (a relative fraction of the matrix scale) admits a genuinely
 * semidefinite Pcc (a zero pivot from a rank-deficient but valid covariance) while a negative
 * eigenvalue still drives a pivot below the jittered floor and throws. Loud and located.
 */
function assertPsd(a: Mat): void {
  const n = a.rows;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[i * n + i]!);
    if (d > scale) scale = d;
  }
  const jitter = (scale || 1) * n * Number.EPSILON;
  const jittered = new Float64Array(a.data);
  for (let i = 0; i < n; i++) jittered[i * n + i]! += jitter;
  try {
    cholesky(mat(n, n, jittered));
  } catch (e) {
    throw new SingularMatrixError(
      `considerCovariance: a-priori consider covariance Pcc is not positive semidefinite (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }
}

export function considerCovariance(informationXx: Float64Array, blocks: ConsiderBlocks): Float64Array {
  const nc = blocks.count;
  const lambdaXx = symmetrize(mat(6, 6, Float64Array.from(informationXx)));
  const pxx = symInverse(lambdaXx); // 6x6
  const lambdaXc: Mat = mat(6, nc, Float64Array.from(blocks.crossInformation)); // 6 x nc
  // Symmetrize Pcc on entry (a-priori covariances arrive with rounding asymmetry) and assert it
  // is positive semidefinite. Pcc is used raw in the inflation Sxc Pcc Sxc^T; if it were
  // asymmetric or indefinite that quadratic could come out indefinite too, breaking the
  // guarantee Pc >= Pxx. Cholesky on the symmetrized matrix throws on a negative pivot, so an
  // indefinite Pcc fails loudly here rather than silently producing an under-stated covariance.
  // A small jitter admits a genuinely semidefinite (rank-deficient) Pcc, e.g. a perfectly
  // correlated consider pair, without rejecting it for a zero pivot.
  const pcc: Mat = symmetrize(mat(nc, nc, Float64Array.from(blocks.considerCovariance))); // nc x nc
  assertPsd(pcc);

  // Sensitivity Sxc = -Pxx Lambda_xc (6 x nc).
  const sxc = matmul(pxx, lambdaXc);
  for (let k = 0; k < sxc.data.length; k++) sxc.data[k] = -sxc.data[k]!;

  // Inflation Sxc Pcc Sxc^T (6 x 6).
  const sPcc = matmul(sxc, pcc); // 6 x nc
  const inflation = matmul(sPcc, transpose(sxc)); // 6 x 6

  const pc = new Float64Array(36);
  for (let k = 0; k < 36; k++) pc[k] = pxx.data[k]! + inflation.data[k]!;
  return symmetrize(mat(6, 6, pc)).data;
}
