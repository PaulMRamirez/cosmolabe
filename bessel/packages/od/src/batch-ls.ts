// Batch least squares by Gauss-Newton. Given an initial 6-state guess at the solve
// epoch t0, a force model, and measurements scattered over epochs, each iteration:
//   1. propagate the current estimate from t0 across the measurement epochs (with STM);
//   2. for each measurement i at epoch t_i, form the residual y_i = obs - h(x(t_i)) and
//      map the measurement partial back to t0:  H_i = (dh/dx)_i * Phi(t_i, t0);
//   3. accumulate the weighted normal equations  Lambda = sum H_i^T W_i H_i  and the
//      right side  N = sum H_i^T W_i y_i, with W_i the inverse measurement covariance;
//   4. solve Lambda dx = N (Gaussian elimination), update x0 += dx, repeat.
// Convergence is on the state update norm (weighted by the state scale). The estimate
// covariance is Lambda^-1. Fails loudly on a singular normal matrix or non-convergence.
// (Tapley-Schutz-Born §4.3; Vallado §10.2.)

import type { ForceModel } from '@bessel/propagator';
import { considerCovariance, type ConsiderSensitivity } from './consider.ts';
import { ConvergenceError, SingularMatrixError } from './errors.ts';
import { gaussSolve, mat, symInverse, symmetrize, type Mat } from './linalg.ts';
import { noiseVariances, predict, residual } from './measurements.ts';
import { propagateArc, type Arc } from './propagate.ts';
import { measurementSize, type Measurement, type OdState } from './types.ts';

export interface BatchOptions {
  /** Force model defining the dynamics (same model used to generate truth). */
  readonly forceModel: ForceModel;
  /** Maximum Gauss-Newton iterations (default 20). */
  readonly maxIterations?: number;
  /**
   * Convergence tolerance on the RMS of the (sigma-normalized) state update; once the
   * step is below this the iteration stops as converged (default 1e-10).
   */
  readonly tolerance?: number;
  /** Inertial frame label passed to the propagator (default 'J2000'). */
  readonly frame?: string;
  /**
   * Optional consider-parameter analysis. When present, the estimator accumulates the cross
   * information Lambda_xc = sum Hx^T W Hc alongside the normal equations and, at convergence,
   * reports the consider covariance Pc = Pxx + Sxc Pcc Sxc^T (see consider.ts). The estimated
   * state is unchanged: consider parameters inflate the reported covariance, they are not solved.
   */
  readonly consider?: ConsiderConfig;
}

/** Consider-parameter configuration: how many, their a-priori covariance, and their sensitivity. */
export interface ConsiderConfig {
  /** Number of consider parameters nc (>= 1). */
  readonly count: number;
  /** A-priori consider covariance Pcc, row-major (nc x nc), symmetric positive semidefinite. */
  readonly covariance: Float64Array;
  /**
   * The consider sensitivity for measurement `m` at its mapped solve-epoch partial: the (size x
   * nc) matrix dh/dp, row-major, where rows are the measurement's scalar components in the order
   * `predict` returns them and columns are the consider parameters. `stateAt` and `stmAt` give the
   * propagated state and STM Phi(t_i, t0) at the measurement epoch so a dynamic consider parameter
   * (e.g. drag) can be STM-mapped; a pure measurement bias ignores them.
   */
  sensitivity(m: Measurement, stateAt: Float64Array, stmAt: Float64Array): ConsiderSensitivity;
}

export interface BatchResult {
  /** The estimated 6-state at t0. */
  readonly state: OdState;
  /** The 6x6 estimate covariance, Lambda^-1 (row-major, length 36). */
  readonly covariance: Float64Array;
  /** RMS of the (sigma-normalized) post-fit residuals at convergence. */
  readonly residualRms: number;
  /** Gauss-Newton iterations performed. */
  readonly iterations: number;
  /** Number of scalar measurement components fitted. */
  readonly observationCount: number;
  /**
   * The consider covariance Pc = Pxx + Sxc Pcc Sxc^T (6x6 row-major), present only when
   * `options.consider` was supplied. Always Pc >= Pxx (positive-semidefinite inflation).
   */
  readonly considerCovariance?: Float64Array;
}

/** Multiply a (size x 6) row-major Jacobian by the 6x6 STM (row-major) into a (size x 6). */
function jacTimesStm(jac: Float64Array, size: number, phi: Float64Array): Mat {
  const out = new Float64Array(size * 6);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < 6; j++) {
      let acc = 0;
      for (let k = 0; k < 6; k++) acc += jac[i * 6 + k]! * phi[k * 6 + j]!;
      out[i * 6 + j] = acc;
    }
  }
  return mat(size, 6, out);
}

/**
 * Levenberg-Marquardt ridge: add a small fraction of the diagonal magnitude to each diagonal entry
 * of a 6x6 normal matrix so a rank-deficient (collapsed) iterate yields a defined, damped step
 * instead of an undefined Gauss-Newton step. Used only as a fallback when the un-damped normal
 * matrix is singular; the damping shrinks the step toward gradient descent and lets the
 * residual-growth guard observe the divergence over consecutive iterations.
 */
function ridge(lambda: Mat): Mat {
  let maxDiag = 0;
  for (let i = 0; i < 6; i++) maxDiag = Math.max(maxDiag, Math.abs(lambda.data[i * 6 + i]!));
  const lam = Float64Array.from(lambda.data);
  const eps = (maxDiag || 1) * 1e-6;
  for (let i = 0; i < 6; i++) lam[i * 6 + i]! += eps;
  return mat(6, 6, lam);
}

/**
 * Estimate the 6-state at `t0` from `measurements` by Gauss-Newton batch least squares,
 * starting from `initialGuess`. `initialGuess.epoch` is the solve epoch t0 and must be
 * at or before the earliest measurement.
 */
export function batchLeastSquares(
  initialGuess: OdState,
  measurements: readonly Measurement[],
  options: BatchOptions,
): BatchResult {
  const maxIter = options.maxIterations ?? 20;
  const tol = options.tolerance ?? 1e-10;
  const t0 = initialGuess.epoch;
  const epochs = measurements.map((m) => m.epoch);
  const x0 = Float64Array.from(initialGuess.x);

  let observationCount = 0;
  for (const m of measurements) observationCount += measurementSize(m);

  let lastUpdateRms = Number.POSITIVE_INFINITY;
  let lastResidualRms = Number.POSITIVE_INFINITY;
  let prevResidualRms = Number.POSITIVE_INFINITY;
  let bestResidualRms = Number.POSITIVE_INFINITY;
  let bestState = Float64Array.from(x0);
  let converged = false;
  // Divergence guard. The residual RMS is measured against the BEST fit found so far, not just the
  // previous step, so the genuine weak-geometry case (where the residual oscillates within a small
  // factor of its floor as the step wanders in the unobservable subspace) is NOT mistaken for
  // divergence. A step counts as "blowing up" only when its residual exceeds the best by more than
  // DIVERGENCE_FACTOR; a sustained run of such steps (the Gauss-Newton step marching away from the
  // minimum, residual climbing by orders of magnitude) is real divergence and throws loudly,
  // instead of the old rule that read any residual increase as a (false) convergence.
  let blowupStreak = 0;
  const MAX_BLOWUP_STREAK = 3;
  const DIVERGENCE_FACTOR = 4;
  let lambda: Mat = mat(6, 6);
  let bestLambda: Mat = mat(6, 6);
  let iter = 0;

  for (iter = 1; iter <= maxIter; iter++) {
    const arc = propagateArc(x0, t0, epochs, options.forceModel, options.frame);

    const lam = new Float64Array(36); // sum H^T W H
    const rhsN = new Float64Array(6); // sum H^T W y
    let weightedSq = 0;
    let weightedCount = 0;

    for (const m of measurements) {
      const size = measurementSize(m);
      const stateAt = arc.stateAt(m.epoch);
      const pred = predict(m, stateAt);
      const resid = residual(m, pred.value); // obs - model, size-length
      const phi = arc.stmAt(m.epoch);
      const H = jacTimesStm(pred.jac, size, phi); // size x 6
      const varns = noiseVariances(m); // size-length sigma^2

      for (let i = 0; i < size; i++) {
        const w = 1 / varns[i]!;
        const normalized = resid[i]! * Math.sqrt(w);
        weightedSq += normalized * normalized;
        weightedCount += 1;
        // accumulate H_i^T w H_i and H_i^T w y_i
        for (let a = 0; a < 6; a++) {
          const Ha = H.data[i * 6 + a]!;
          if (Ha === 0) continue;
          rhsN[a]! += Ha * w * resid[i]!;
          for (let b = 0; b < 6; b++) {
            lam[a * 6 + b]! += Ha * w * H.data[i * 6 + b]!;
          }
        }
      }
    }

    lambda = symmetrize(mat(6, 6, lam));
    const residualRms = Math.sqrt(weightedSq / Math.max(1, weightedCount));

    // The residual RMS is evaluated at the CURRENT x0 (before this step's update). Once
    // it stops decreasing meaningfully, the cost function has bottomed: the previous
    // state is the best fit and we are done. This is the textbook batch stopping rule
    // and it handles weak-geometry cases (e.g. range-only), where dx never reaches the
    // raw `tol` because it wanders in the unobservable, integrator-noise floor.
    const relResidualChange = (prevResidualRms - residualRms) / Math.max(prevResidualRms, 1e-300);
    if (iter > 1) {
      if (residualRms > bestResidualRms * DIVERGENCE_FACTOR) {
        // This step's residual is well above the best fit so far: the iterate is blowing up, not
        // bottoming out. Count the run; a sustained blow-up is divergence (the Gauss-Newton step
        // marching away from the minimum), which must fail loudly rather than report a false
        // convergence on the unimproved state.
        blowupStreak += 1;
        if (blowupStreak >= MAX_BLOWUP_STREAK) {
          throw new ConvergenceError(
            iter,
            residualRms,
            tol,
            `residual RMS grew beyond ${DIVERGENCE_FACTOR}x the best fit on ${blowupStreak} consecutive iterations`,
          );
        }
        // Tolerated transient blow-up: take another step (the streak may still recover).
      } else {
        // Within DIVERGENCE_FACTOR of the best fit: not diverging. Clear the streak.
        blowupStreak = 0;
        // Bottomed-out test: the residual stopped improving on the best (a negligible reduction, or
        // it failed to beat the best while staying near it, the weak-geometry noise-floor case).
        // Either way the cost has bottomed; keep the best state and its information matrix. The old
        // rule converged on ANY residual increase (relResidualChange <= tol), which a divergent
        // step also satisfied; restricting "bottomed" to the near-best regime closes that hole.
        const improvedOnBest = residualRms < bestResidualRms * (1 - tol);
        if (!improvedOnBest && relResidualChange <= tol) {
          converged = true;
          lastResidualRms = bestResidualRms;
          break;
        }
      }
    }
    // Record the running best only on a genuine improvement (so a transient worsening step that the
    // streak guard tolerates does not overwrite the best state with an inferior fit). Always
    // advance prevResidualRms so the next iteration's relative change is measured against THIS step.
    if (residualRms < bestResidualRms) {
      bestResidualRms = residualRms;
      bestState = Float64Array.from(x0);
      bestLambda = lambda;
    }
    prevResidualRms = residualRms;
    lastResidualRms = residualRms;

    // Solve the normal equations for the Gauss-Newton step. gaussSolve uses scaled partial pivoting
    // and rejects a pivot that is negligible RELATIVE to its row scale (a genuinely rank-deficient
    // normal matrix), which the old absolute 1e-300 floor missed, returning a garbage step and an
    // over-optimistic covariance. A merely ill-conditioned but full-rank iterate still solves.
    // If the normal matrix at this iterate is rank-deficient (a wildly-off iterate whose
    // linearization has collapsed), fall back to a Levenberg-Marquardt-damped step: add a small
    // ridge proportional to the diagonal so the step is defined, then let the residual-growth guard
    // above detect the resulting divergence over consecutive iterations. The FINAL covariance still
    // goes through symInverse (Cholesky), which independently asserts the converged matrix is SPD.
    let dx: Float64Array;
    try {
      dx = gaussSolve(lambda, rhsN);
    } catch (e) {
      if (!(e instanceof SingularMatrixError)) throw e;
      dx = gaussSolve(ridge(lambda), rhsN);
    }
    for (let i = 0; i < 6; i++) x0[i]! += dx[i]!;

    let sq = 0;
    for (let i = 0; i < 6; i++) sq += dx[i]! * dx[i]!;
    lastUpdateRms = Math.sqrt(sq / 6);
    if (lastUpdateRms <= tol) {
      // The update itself is negligible: the post-step state is the best estimate.
      bestState = Float64Array.from(x0);
      bestLambda = lambda;
      converged = true;
      break;
    }
  }

  if (!converged) {
    throw new ConvergenceError(maxIter, lastResidualRms, tol);
  }

  const covariance = symInverse(bestLambda).data; // Lambda^-1 (throws if not SPD)
  const consider = options.consider
    ? considerCovariance(bestLambda.data, {
        crossInformation: accumulateCrossInformation(bestState, t0, measurements, options),
        considerCovariance: options.consider.covariance,
        count: options.consider.count,
      })
    : undefined;
  return {
    state: { x: bestState, epoch: t0 },
    covariance,
    residualRms: lastResidualRms,
    iterations: Math.min(iter, maxIter),
    observationCount,
    considerCovariance: consider,
  };
}

/**
 * Accumulate the cross information Lambda_xc = sum Hx^T W Hc at the converged state, where Hx is
 * the STM-mapped measurement partial (size x 6) and Hc the STM-mapped consider partial (size x
 * nc). One extra propagation of the converged arc; cheap relative to the Gauss-Newton iteration.
 */
function accumulateCrossInformation(
  state0: Float64Array,
  t0: number,
  measurements: readonly Measurement[],
  options: BatchOptions,
): Float64Array {
  const cfg = options.consider!;
  const nc = cfg.count;
  const epochs = measurements.map((m) => m.epoch);
  const arc: Arc = propagateArc(state0, t0, epochs, options.forceModel, options.frame);
  const lambdaXc = new Float64Array(6 * nc);
  for (const m of measurements) {
    const size = measurementSize(m);
    const stateAt = arc.stateAt(m.epoch);
    const phi = arc.stmAt(m.epoch);
    const pred = predict(m, stateAt);
    const H = jacTimesStm(pred.jac, size, phi); // size x 6, mapped to t0
    const varns = noiseVariances(m); // size sigma^2
    const hc = cfg.sensitivity(m, stateAt, phi).partials; // size x nc
    for (let i = 0; i < size; i++) {
      const w = 1 / varns[i]!;
      for (let a = 0; a < 6; a++) {
        const Ha = H.data[i * 6 + a]!;
        if (Ha === 0) continue;
        for (let cidx = 0; cidx < nc; cidx++) {
          lambdaXc[a * nc + cidx]! += Ha * w * hc[i * nc + cidx]!;
        }
      }
    }
  }
  return lambdaXc;
}
