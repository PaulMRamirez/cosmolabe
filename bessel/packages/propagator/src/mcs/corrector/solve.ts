// The damped Newton differential corrector. Each iteration evaluates the residual, builds
// the Jacobian (STM-analytic where possible), solves J dc = -f by the appropriate shape
// (square / least-squares / minimum-norm), clamps the step to the trust region, and (with
// armijo damping) backtracks until the scaled residual norm decreases. Converges on the raw
// per-goal tolerance, else throws DcNotConvergedError carrying the best-so-far state. Fails
// loudly on a singular Jacobian. (STK_PARITY_SPEC §4.3.)

import type { DcSettings, GoalType, Objective, Segment } from '../segments.ts';
import { DcNotConvergedError, SingularJacobianError } from '../errors.ts';
import type { ControlBinding, GoalBinding } from './refs.ts';
import { evaluateResidual, type DcEvalContext } from './residual.ts';
import { assembleJacobian } from './jacobian.ts';
import { conditionEstimate, solveLeastSquares, solveMinNorm, solveSquare } from './linalg.ts';
import { runOptimizer, type OptimizerReport } from './optimize.ts';
import { runSqpOptimizer } from './sqp.ts';

export interface PerGoalReport {
  readonly type: GoalType;
  readonly achieved: number;
  readonly desired: number;
  readonly residual: number;
  readonly satisfied: boolean;
}

export interface DcReport {
  readonly segmentPath: readonly string[];
  readonly converged: boolean;
  readonly iterations: number;
  readonly controls: Float64Array;
  readonly residuals: Float64Array; // raw, per goal
  readonly perGoal: readonly PerGoalReport[];
  readonly history: readonly { readonly iter: number; readonly normF: number }[];
  readonly extraRuns: number;
}

const norm2 = (v: Float64Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/** Armijo sufficient-decrease coefficient for the corrector backtracking line search. */
const ARMIJO_C = 1e-4;

function perGoalOf(goals: readonly GoalBinding[], raw: Float64Array): PerGoalReport[] {
  return goals.map((g, i) => ({
    type: g.type,
    achieved: raw[i]! + g.desired,
    desired: g.desired,
    residual: raw[i]!,
    satisfied: Math.abs(raw[i]!) <= g.tolerance,
  }));
}

const converged = (goals: readonly GoalBinding[], raw: Float64Array): boolean =>
  goals.every((g, i) => Math.abs(raw[i]!) <= g.tolerance);

function newtonStep(J: Float64Array, negF: Float64Array, m: number, n: number): Float64Array {
  if (m === n) return solveSquare(J, negF, n);
  if (m > n) return solveLeastSquares(J, negF, m, n);
  return solveMinNorm(J, negF, m, n);
}

export function runDifferentialCorrector(
  controls: readonly ControlBinding[],
  goals: readonly GoalBinding[],
  ctx: DcEvalContext,
  settings: DcSettings,
  segmentPath: readonly string[],
): { report: DcReport; solvedChildren: readonly Segment[] } {
  const n = controls.length;
  const m = goals.length;
  const c = Float64Array.from(controls, (cb) => cb.read());
  const history: { iter: number; normF: number }[] = [];
  let extraRuns = 0;
  let best = { c: Float64Array.from(c), normF: Infinity, raw: new Float64Array(m) };

  for (let iter = 0; iter < settings.maxIterations; iter++) {
    const base = evaluateResidual(c, controls, ctx, settings.useStm);
    const normF = norm2(base.residualScaled);
    history.push({ iter, normF });
    if (normF < best.normF) best = { c: Float64Array.from(c), normF, raw: Float64Array.from(base.residualRaw) };

    if (converged(goals, base.residualRaw)) {
      return finish(true, iter, c, base.residualRaw);
    }

    const jac = assembleJacobian(c, base, controls, goals, ctx, settings);
    extraRuns += jac.extraRuns;
    const cond = conditionEstimate(jac.J, m, n);
    if (!Number.isFinite(cond) || cond > settings.conditionLimit) {
      throw new SingularJacobianError(segmentPath, cond);
    }

    const negF = Float64Array.from(base.residualScaled, (x) => -x);
    const dNondim = newtonStep(jac.J, negF, m, n);
    // Back to physical control units, with the trust-region clamp.
    const dc = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let step = dNondim[j]! * controls[j]!.scale;
      if (settings.trustRegion) step = Math.max(-controls[j]!.maxStep, Math.min(controls[j]!.maxStep, step));
      dc[j] = step;
    }

    // Damped line search on the scaled residual norm with a real Armijo sufficient-decrease test:
    // accept lambda only when the trial norm drops by at least ARMIJO_C * lambda of the current
    // norm (the Newton direction is a descent direction on ||F||, so such a lambda exists unless we
    // are already stationary). The old loop force-accepted the smallest-lambda step on the final
    // backtrack regardless of decrease, so the corrector could take an UPHILL move and the post-loop
    // fallback was dead. Now an exhausted backtrack REJECTS the step: c is left unchanged and the
    // corrector stops, failing loudly with the best-so-far rather than stepping uphill.
    let lambda = 1;
    let accepted = false;
    const maxBacktracks = settings.damping === 'armijo' ? 8 : 0;
    for (let b = 0; b <= maxBacktracks; b++) {
      const trial = Float64Array.from(c, (cj, j) => cj + lambda * dc[j]!);
      const ev = evaluateResidual(trial, controls, ctx, false);
      const trialNorm = norm2(ev.residualScaled);
      const sufficientDecrease = trialNorm <= (1 - ARMIJO_C * lambda) * normF;
      if (settings.damping === 'none' || sufficientDecrease) {
        c.set(trial);
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    // No backtrack achieved sufficient decrease: reject (do NOT step uphill) and break to the loud
    // non-convergence path with the best iterate seen so far.
    if (!accepted) break;
  }

  // Exhausted iterations (or a stalled line search that found no feasible descent): report the
  // best-so-far and fail loudly.
  const raw = best.raw;
  const report = buildReport(false, settings.maxIterations, best.c, raw);
  throw new DcNotConvergedError(segmentPath, settings.maxIterations, best.c, raw, report.perGoal);

  function finish(ok: boolean, iters: number, cc: Float64Array, raw: Float64Array) {
    const report = buildReport(ok, iters, cc, raw);
    let tree: readonly Segment[] = ctx.children;
    for (let j = 0; j < n; j++) tree = controls[j]!.write(tree, cc[j]!);
    return { report, solvedChildren: tree };
  }

  function buildReport(ok: boolean, iters: number, cc: Float64Array, raw: Float64Array): DcReport {
    return {
      segmentPath,
      converged: ok,
      iterations: iters,
      controls: Float64Array.from(cc),
      residuals: Float64Array.from(raw),
      perGoal: perGoalOf(goals, raw),
      history,
      extraRuns,
    };
  }
}

/**
 * Run an OPTIMIZER-mode Target: satisfy the goals AND minimize `objective` over the controls.
 * It reuses the corrector's Newton step as the feasibility-restoration operator, then runs the
 * projected-gradient optimizer (optimize.ts). Returns the optimizer report (with the optimal
 * controls) and the solved child tree, so the executor can replay it exactly like the corrector.
 */
export function runTargetOptimizer(
  objective: Objective,
  controls: readonly ControlBinding[],
  goals: readonly GoalBinding[],
  ctx: DcEvalContext,
  settings: DcSettings,
  segmentPath: readonly string[],
): { report: OptimizerReport; solvedChildren: readonly Segment[] } {
  const n = controls.length;
  const m = goals.length;

  // Feasibility restoration: a bounded damped-Newton loop (min-norm when underdetermined) that
  // takes any control vector to one meeting every goal tolerance. Same machinery as the DC.
  const restore = (start: Float64Array): { c: Float64Array; raw: Float64Array; extraRuns: number } => {
    const c = Float64Array.from(start);
    let extra = 0;
    let raw = new Float64Array(m);
    for (let iter = 0; iter < settings.maxIterations; iter++) {
      const base = evaluateResidual(c, controls, ctx, settings.useStm);
      raw = Float64Array.from(base.residualRaw);
      if (converged(goals, raw)) return { c, raw, extraRuns: extra };
      const jac = assembleJacobian(c, base, controls, goals, ctx, settings);
      extra += jac.extraRuns;
      // The condition proxy uses the normal equations A^T A (n x n), which is rank-deficient for
      // an UNDERDETERMINED system (m < n) and would always flag singular. The min-norm solve uses
      // A A^T (m x m) instead, so guard the condition check to the square/overdetermined cases and
      // let solveMinNorm throw if A A^T is genuinely singular.
      if (m >= n) {
        const cond = conditionEstimate(jac.J, m, n);
        if (!Number.isFinite(cond) || cond > settings.conditionLimit) throw new SingularJacobianError(segmentPath, cond);
      }
      const negF = Float64Array.from(base.residualScaled, (x) => -x);
      const dNondim = newtonStep(jac.J, negF, m, n);
      for (let j = 0; j < n; j++) {
        let step = dNondim[j]! * controls[j]!.scale;
        if (settings.trustRegion) step = Math.max(-controls[j]!.maxStep, Math.min(controls[j]!.maxStep, step));
        c[j]! += step;
      }
    }
    return { c, raw, extraRuns: extra };
  };

  // The objective selects the method: 'sqp' uses the second-order KKT step (sqp.ts), anything
  // else (the default) uses the first-order projected gradient (optimize.ts). Both share the
  // restore closure and return the same report shape.
  const opt =
    objective.method === 'sqp'
      ? runSqpOptimizer(objective, controls, goals, ctx, settings, segmentPath, restore)
      : runOptimizer(objective, controls, goals, ctx, settings, segmentPath, restore);
  let tree: readonly Segment[] = ctx.children;
  for (let j = 0; j < n; j++) tree = controls[j]!.write(tree, opt.controls[j]!);
  return { report: opt.report, solvedChildren: tree };
}
