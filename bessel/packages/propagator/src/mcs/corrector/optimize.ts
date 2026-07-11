// OPTIMIZER mode for an MCS Target: minimize a scalar objective (e.g. total delta-v) subject to
// the goal constraints g(c) = 0, over redundant controls (n > m). The method is a projected
// (reduced) gradient descent with constraint restoration, a feasible-direction scheme:
//
//   1. RESTORE: drive the goals to feasibility with the existing damped-Newton step (min-norm
//      when underdetermined), reusing the corrector machinery, so we start on the constraint
//      manifold g(c) = 0.
//   2. PROJECT: build the constraint Jacobian J = d(scaled residual)/d(nondim control) (m x n)
//      and the cost gradient (in the same nondim control space). Project the cost gradient onto
//      the null space of J: gProj = (I - J^T (J J^T)^-1 J) grad. The descent direction is -gProj;
//      moving along it changes the cost while staying (to first order) on the constraints.
//   3. LINE SEARCH: take a backtracking step along -gProj that reduces the cost, then RESTORE
//      feasibility again (one Newton min-norm correction of the small residual the step opened).
//   4. Repeat until the projected-gradient norm falls below the tolerance (a first-order KKT
//      stationarity test) or the step stalls.
//
// This is the textbook gradient-projection / reduced-gradient method for equality-constrained
// NLPs (Rosen's gradient projection; Luenberger-Ye, Linear and Nonlinear Programming §11-12).
// It needs n > m to have a non-trivial null space; with n == m the feasible point is unique and
// the optimizer reduces to the corrector. (STK_PARITY_SPEC §4.3 targeting, extended to optimize.)

import type { DcSettings, Objective } from '../segments.ts';
import { OptimizerNotConvergedError } from '../errors.ts';
import type { ControlBinding, GoalBinding } from './refs.ts';
import { evaluateResidual, type DcEvalContext } from './residual.ts';
import { assembleJacobian } from './jacobian.ts';
import { solveSquare } from './linalg.ts';
import { evaluateObjective } from './objective.ts';

export interface OptimizerReport {
  readonly converged: boolean;
  readonly outerIterations: number;
  /** Final control vector (physical units). */
  readonly controls: Float64Array;
  /** Final objective cost. */
  readonly cost: number;
  /** Cost at the first feasible point, before optimization (for diagnostics). */
  readonly initialCost: number;
  /** Final projected-gradient norm (the stationarity residual). */
  readonly projectedGradientNorm: number;
  /** Total extra residual propagations spent across all sweeps. */
  readonly extraRuns: number;
  /**
   * True if optimization stopped on a line-search stall (no feasible cost decrease found) rather
   * than on the stationarity test. A stall means the reported point is feasible but NOT certified
   * first-order optimal: `converged` is false. Distinct from convergence so a caller can tell a
   * true optimum from a stuck iterate.
   */
  readonly stalled: boolean;
}

const norm2 = (v: Float64Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const goalsMet = (goals: readonly GoalBinding[], raw: Float64Array): boolean => goals.every((g, i) => Math.abs(raw[i]!) <= g.tolerance);

/**
 * Run the projected-gradient optimizer. `restore` is a closure that takes the current control
 * vector to a feasible one (the corrector's Newton solve, supplied by the caller so this module
 * stays free of the corrector's line-search policy). Returns the optimal controls and a report.
 */
export function runOptimizer(
  objective: Objective,
  controls: readonly ControlBinding[],
  goals: readonly GoalBinding[],
  ctx: DcEvalContext,
  settings: DcSettings,
  segmentPath: readonly string[],
  restore: (c: Float64Array) => { c: Float64Array; raw: Float64Array; extraRuns: number },
): { report: OptimizerReport; controls: Float64Array } {
  const n = controls.length;
  const m = goals.length;
  let extraRuns = 0;

  // 1. Restore to a first feasible point.
  const c0 = Float64Array.from(controls, (cb) => cb.read());
  const r0 = restore(c0);
  extraRuns += r0.extraRuns;
  let c = Float64Array.from(r0.c);
  if (!goalsMet(goals, r0.raw)) {
    throw new OptimizerNotConvergedError(segmentPath, 0, c, 'could not reach a feasible starting point');
  }
  const initialCost = evaluateObjective(objective, c, controls).cost;

  let projNorm = Infinity;
  let stalled = false;
  // The finite-difference cost/constraint gradients cannot resolve the reduced gradient below their
  // own noise floor (~sqrt of the relative perturbation, the textbook FD-gradient accuracy limit).
  // Stationarity is certified at the smaller of the requested tolerance and this achievable floor,
  // so a genuine optimum (reduced gradient at the FD floor) is recognized while a premature stall
  // (reduced gradient orders of magnitude larger) is not. Set from the last sweep's gradient scale.
  const fdFloor = Math.sqrt(settings.perturbationRel);
  let stationarityThreshold = settings.optimizerTolerance;
  let iter = 0;
  for (iter = 0; iter < settings.optimizerMaxIterations; iter++) {
    const base = evaluateResidual(c, controls, ctx, settings.useStm);
    const jac = assembleJacobian(c, base, controls, goals, ctx, settings);
    extraRuns += jac.extraRuns;

    // Cost gradient in nondim control space: physical df/dc times the control scale.
    const og = evaluateObjective(objective, c, controls);
    const gradNondim = new Float64Array(n);
    for (let j = 0; j < n; j++) gradNondim[j] = og.gradient[j]! * controls[j]!.scale;

    const proj = projectOntoNullSpace(jac.J, m, n, gradNondim);
    projNorm = norm2(proj);
    stationarityThreshold = Math.max(settings.optimizerTolerance, fdFloor * Math.max(norm2(gradNondim), 1));
    if (projNorm <= settings.optimizerTolerance) break;

    // Descent direction in nondim space is -proj; back to physical control units.
    const dirPhys = new Float64Array(n);
    for (let j = 0; j < n; j++) dirPhys[j] = -proj[j]! * controls[j]!.scale;

    // Backtracking line search on the cost, restoring feasibility at each trial.
    let step = initialStep(c, dirPhys);
    let accepted = false;
    for (let bt = 0; bt < 30; bt++) {
      const trial = Float64Array.from(c, (cj, j) => cj + step * dirPhys[j]!);
      const rest = restore(trial);
      extraRuns += rest.extraRuns;
      if (goalsMet(goals, rest.raw)) {
        const trialCost = evaluateObjective(objective, rest.c, controls).cost;
        if (trialCost < og.cost - 1e-14) {
          c = Float64Array.from(rest.c);
          accepted = true;
          break;
        }
      }
      step /= 2;
    }
    if (!accepted) {
      // The line search exhausted its backtracks without a feasible cost decrease. This is a STALL,
      // not a certified optimum: the projected-gradient norm may still exceed the tolerance. Record
      // it and stop; convergence is decided solely by the stationarity test below.
      stalled = true;
      break;
    }
  }

  const finalRaw = evaluateResidual(c, controls, ctx, false).residualRaw;
  if (!goalsMet(goals, finalRaw)) {
    throw new OptimizerNotConvergedError(segmentPath, iter, c, 'final point is infeasible');
  }
  // Convergence is the first-order KKT stationarity test ALONE: the projected (reduced) gradient
  // norm at or below the stationarity threshold (the requested tolerance, or the FD-gradient noise
  // floor when that is larger). Reaching the iteration cap or stalling in the line search is NOT by
  // itself convergence: a stall counts only when the reduced gradient is genuinely stationary. The
  // old `|| iter < maxIterations` reported converged:true for ANY early break, so a stall far from
  // the optimum (large reduced gradient) was a false success.
  const converged = projNorm <= stationarityThreshold;
  return {
    report: {
      converged,
      stalled,
      outerIterations: iter,
      controls: Float64Array.from(c),
      cost: evaluateObjective(objective, c, controls).cost,
      initialCost,
      projectedGradientNorm: projNorm,
      extraRuns,
    },
    controls: Float64Array.from(c),
  };
}

/** A scale-aware initial line-search step so the first move is order the control magnitude. */
function initialStep(c: Float64Array, dir: Float64Array): number {
  const cn = norm2(c);
  const dn = norm2(dir);
  if (dn === 0) return 0;
  // Aim for a first move of ~10% of the control magnitude (or unit if controls are tiny).
  return (0.1 * Math.max(cn, 1)) / dn;
}

/**
 * Project `g` (length n) onto the null space of J (m x n): gProj = g - J^T (J J^T)^-1 (J g).
 * When m == 0 (no constraints) the projection is the identity. Falls back to the raw gradient if
 * J J^T is singular (a degenerate constraint set), which keeps the optimizer making progress.
 */
function projectOntoNullSpace(J: Float64Array, m: number, n: number, g: Float64Array): Float64Array {
  if (m === 0) return Float64Array.from(g);
  // Jg = J g (length m).
  const Jg = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += J[i * n + j]! * g[j]!;
    Jg[i] = s;
  }
  // JJt = J J^T (m x m).
  const JJt = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < m; k++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += J[i * n + j]! * J[k * n + j]!;
      JJt[i * m + k] = s;
    }
  }
  let y: Float64Array;
  try {
    y = solveSquare(JJt, Jg, m); // (J J^T) y = J g
  } catch {
    return Float64Array.from(g); // degenerate: skip the projection this sweep
  }
  // gProj = g - J^T y.
  const out = Float64Array.from(g);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += J[i * n + j]! * y[i]!;
    out[j] = g[j]! - s;
  }
  return out;
}
