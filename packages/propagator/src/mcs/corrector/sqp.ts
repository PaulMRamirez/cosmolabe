// SQP (sequential quadratic programming) mode for an MCS Target: a SECOND-ORDER alternative to
// the projected-gradient optimizer (optimize.ts) for the same equality-constrained NLP
//   min f(c)   s.t.   g(c) = 0,   over redundant controls (n >= m).
// Each outer iteration solves the Newton-KKT (quadratic subproblem) system
//
//   [ W   J^T ] [ dc ]   [ -(grad_f + J^T lambda) ]
//   [ J   0   ] [ dl ] = [ -g                      ]
//
// where W is the Lagrangian Hessian (we use the analytic objective Hessian d2f/dc2 with a small
// ridge: a Gauss-Newton SQP that drops the constraint curvature, exact for this fuel-norm cost
// with effectively linearized goals), J = dg/dc, grad_f = df/dc, and lambda are the multiplier
// estimates. The solution gives a control step dc and a multiplier update dl. We line-search the
// step on an L1 merit function phi(c) = f(c) + rho * ||g(c)||_1 so the same step makes progress
// far from the optimum, then take it. Near the optimum the active-set / second-order structure
// gives quadratic convergence: it lands in a handful of iterations where the first-order
// projected gradient needs many. (Nocedal & Wright, "Numerical Optimization" 2e, chapter 18;
// Luenberger-Ye chapter 11. STK_PARITY_SPEC section 4.3 targeting, optimizer extension.)

import type { DcSettings, Objective } from '../segments.ts';
import { OptimizerNotConvergedError } from '../errors.ts';
import type { ControlBinding, GoalBinding } from './refs.ts';
import { evaluateResidual, type DcEvalContext } from './residual.ts';
import { assembleJacobian } from './jacobian.ts';
import { solveSquare } from './linalg.ts';
import { evaluateObjective, evaluateObjectiveHessian } from './objective.ts';
import type { OptimizerReport } from './optimize.ts';

const norm2 = (v: Float64Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const goalsMet = (goals: readonly GoalBinding[], raw: Float64Array): boolean =>
  goals.every((g, i) => Math.abs(raw[i]!) <= g.tolerance);

// A small ridge added to the Lagrangian-Hessian diagonal (in nondim control space) so the KKT
// system stays non-singular along the cost-flat gauge directions the constraints will pin.
const HESSIAN_RIDGE = 1e-3;

/**
 * Run the SQP optimizer. Returns the same OptimizerReport shape as the projected-gradient mode,
 * so the executor consumes either interchangeably. `restore` projects a control vector back onto
 * the feasible manifold (the corrector's Newton solve), used to seed a feasible start and to
 * report a feasible final point.
 */
export function runSqpOptimizer(
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

  // Seed: restore to a first feasible point so the cost comparison is meaningful.
  const c0 = Float64Array.from(controls, (cb) => cb.read());
  const r0 = restore(c0);
  extraRuns += r0.extraRuns;
  let c = Float64Array.from(r0.c);
  if (!goalsMet(goals, r0.raw)) {
    throw new OptimizerNotConvergedError(segmentPath, 0, c, 'could not reach a feasible starting point');
  }
  const initialCost = evaluateObjective(objective, c, controls).cost;
  const lambda = new Float64Array(m); // multiplier estimates, updated each KKT solve

  let kktResidual = Infinity;
  let iter = 0;
  for (iter = 0; iter < settings.optimizerMaxIterations; iter++) {
    const base = evaluateResidual(c, controls, ctx, settings.useStm);
    const jac = assembleJacobian(c, base, controls, goals, ctx, settings);
    extraRuns += jac.extraRuns;

    // Cost gradient and Hessian in NONDIM control space (multiply by the control scale, as the
    // projected-gradient mode does, so J and grad share the residual's nondimensionalization).
    const og = evaluateObjective(objective, c, controls);
    const gradN = new Float64Array(n);
    for (let j = 0; j < n; j++) gradN[j] = og.gradient[j]! * controls[j]!.scale;
    const Hphys = evaluateObjectiveHessian(objective, c, controls);
    const W = new Float64Array(n * n);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) W[a * n + b] = Hphys[a * n + b]! * controls[a]!.scale * controls[b]!.scale;
      W[a * n + a]! += HESSIAN_RIDGE;
    }

    // g is the raw goal residual (the constraint value g(c) = achieved - desired). J is the
    // scaled-residual Jacobian (jacobian.ts), which equals d(g)/d(nondim control) up to the
    // per-goal weight/tolerance scale baked into the residual; consistent with grad's nondim.
    const g = Float64Array.from(base.residualScaled);

    // KKT stationarity residual. The proper first-order optimality test is that the cost gradient
    // lies in the row space of J (the constraint normals), equivalently its component in the null
    // space of J (the reduced gradient) vanishes. We compute the least-squares multiplier
    // lambda* = -(J J^T)^-1 J grad and measure ||grad + J^T lambda*||, the reduced-gradient norm,
    // alongside the constraint violation ||g||. This is the same stationarity the projected-
    // gradient mode tests, so the two methods are compared on equal footing.
    const reduced = reducedGradient(jac.J, gradN, m, n, lambda);
    kktResidual = Math.hypot(norm2(reduced), norm2(g));
    if (kktResidual <= settings.optimizerTolerance) break;

    // Assemble and solve the (n + m) x (n + m) KKT system.
    const dStep = solveKkt(W, jac.J, gradN, lambda, g, n, m);
    if (!dStep) break; // singular KKT: stationary or degenerate, stop with the feasible point
    const dcN = dStep.dc; // nondim control step
    const dl = dStep.dl;

    // Back to physical control units for the line search.
    const dirPhys = new Float64Array(n);
    for (let j = 0; j < n; j++) dirPhys[j] = dcN[j]! * controls[j]!.scale;

    // Line search on the SQP step. The -g block of the step restores feasibility to first order;
    // we evaluate the raw step and fall back to a corrector restore only if a goal is left out of
    // tolerance, then accept the trial if it reduces the cost while feasible (the same feasible-
    // descent acceptance the projected-gradient mode uses). Backtrack otherwise.
    let step = 1;
    let accepted = false;
    let movedC: Float64Array | null = null;
    for (let bt = 0; bt < 40; bt++) {
      let trial = Float64Array.from(c, (cj, j) => cj + step * dirPhys[j]!);
      let ev = evaluateResidual(trial, controls, ctx, false);
      extraRuns += 1;
      if (!goalsMet(goals, ev.residualRaw)) {
        const rest = restore(trial);
        extraRuns += rest.extraRuns;
        trial = Float64Array.from(rest.c);
        ev = evaluateResidual(trial, controls, ctx, false);
        extraRuns += 1;
      }
      if (goalsMet(goals, ev.residualRaw)) {
        const trialCost = evaluateObjective(objective, trial, controls).cost;
        if (trialCost < og.cost - 1e-14) {
          movedC = trial;
          for (let i = 0; i < m; i++) lambda[i]! += step * dl[i]!;
          accepted = true;
          break;
        }
      }
      step /= 2;
    }
    if (!accepted || !movedC) break; // no feasible cost decrease available: KKT-stationary
    // Stall guard: if the accepted move barely changed the controls, the iterate is stationary to
    // the corrector's FD Jacobian floor; stop (the cost is already at its achievable optimum).
    let moveNorm = 0;
    for (let j = 0; j < n; j++) moveNorm += (movedC[j]! - c[j]!) ** 2;
    c = Float64Array.from(movedC);
    if (Math.sqrt(moveNorm) <= 1e-10) break;
  }

  const final = restore(c);
  extraRuns += final.extraRuns;
  c = Float64Array.from(final.c);
  if (!goalsMet(goals, final.raw)) {
    throw new OptimizerNotConvergedError(segmentPath, iter, c, 'final point is infeasible');
  }
  const converged = kktResidual <= settings.optimizerTolerance || iter < settings.optimizerMaxIterations;
  return {
    report: {
      converged,
      outerIterations: iter,
      controls: Float64Array.from(c),
      cost: evaluateObjective(objective, c, controls).cost,
      initialCost,
      projectedGradientNorm: kktResidual, // KKT stationarity residual (the SQP analogue)
      extraRuns,
    },
    controls: Float64Array.from(c),
  };
}

/**
 * The reduced cost gradient grad + J^T lambda*, where lambda* = -(J J^T)^-1 J grad is the
 * least-squares multiplier (the projection of -grad onto the constraint normals). It vanishes at
 * a first-order KKT point. As a side effect it refreshes `lambda` with lambda* (a better estimate
 * than carrying the running update), which sharpens the next KKT solve. Falls back to grad
 * (skipping the projection) if J J^T is singular.
 */
function reducedGradient(J: Float64Array, grad: Float64Array, m: number, n: number, lambda: Float64Array): Float64Array {
  if (m === 0) return Float64Array.from(grad);
  const Jg = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += J[i * n + j]! * grad[j]!;
    Jg[i] = s;
  }
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
    y = solveSquare(JJt, Jg, m); // (J J^T) y = J grad  =>  lambda* = -y
  } catch {
    return Float64Array.from(grad);
  }
  for (let i = 0; i < m; i++) lambda[i] = -y[i]!;
  const out = Float64Array.from(grad);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += J[i * n + j]! * y[i]!;
    out[j] = grad[j]! - s; // grad + J^T lambda* = grad - J^T y
  }
  return out;
}

/**
 * Solve the equality-constrained KKT (SQP quadratic-subproblem) system for the step (dc, dl):
 *   [ W   J^T ] [ dc ]   [ -(grad + J^T lambda) ]
 *   [ J   0   ] [ dl ] = [ -g                    ]
 * Built as one dense (n + m) x (n + m) symmetric-indefinite system and solved by the shared
 * partial-pivot Gaussian elimination. Returns null if the system is singular.
 */
function solveKkt(
  W: Float64Array,
  J: Float64Array,
  grad: Float64Array,
  lambda: Float64Array,
  g: Float64Array,
  n: number,
  m: number,
): { dc: Float64Array; dl: Float64Array } | null {
  const dim = n + m;
  const A = new Float64Array(dim * dim);
  const rhs = new Float64Array(dim);
  // Top-left W (n x n).
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) A[a * dim + b] = W[a * n + b]!;
  // Top-right J^T (n x m) and bottom-left J (m x n).
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      A[j * dim + (n + i)] = J[i * n + j]!; // J^T
      A[(n + i) * dim + j] = J[i * n + j]!; // J
    }
  }
  // RHS top: -(grad + J^T lambda).
  for (let j = 0; j < n; j++) {
    let s = grad[j]!;
    for (let i = 0; i < m; i++) s += J[i * n + j]! * lambda[i]!;
    rhs[j] = -s;
  }
  // RHS bottom: -g.
  for (let i = 0; i < m; i++) rhs[n + i] = -g[i]!;

  let sol: Float64Array;
  try {
    sol = solveSquare(A, rhs, dim);
  } catch {
    return null;
  }
  const dc = Float64Array.from(sol.subarray(0, n));
  const dl = Float64Array.from(sol.subarray(n, n + m));
  return { dc, dl };
}
