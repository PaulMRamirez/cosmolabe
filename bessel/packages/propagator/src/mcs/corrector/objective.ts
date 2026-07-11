// The optimizer objective: a scalar cost over the control vector plus its analytic gradient.
// For 'minimizeDeltaV' the cost is the total impulsive delta-v summed over the maneuvers the
// controls drive. A maneuver's delta-v magnitude is the Euclidean norm of its dv-axis controls
// (in km/s), so the gradient of |dv_S| with respect to a component control c_j is c_j / |dv_S|,
// the standard L2-norm subgradient (well-defined while |dv_S| > 0; at the origin we use a
// regularized 0 so a zero burn contributes a finite, vanishing gradient). Controls that are not
// delta-v components (an initial-state r/v or a duration) carry zero cost and zero gradient: they
// reshape the trajectory to keep the goals satisfied without spending fuel. (Conway, Spacecraft
// Trajectory Optimization §3; standard fuel-optimal impulsive targeting.)

import type { ControlBinding } from './refs.ts';
import type { Objective } from '../segments.ts';

export interface CostAndGradient {
  /** The scalar cost f(c). */
  readonly cost: number;
  /** df/dc in physical control units, length n. */
  readonly gradient: Float64Array;
}

/** Regularizer so the L2-norm gradient stays finite as |dv| -> 0. */
const DV_EPS = 1e-12;

/**
 * Evaluate the objective cost and its gradient at the control vector `c`. Only the
 * 'minimizeDeltaV' objective is implemented; the maneuver grouping is read from each control's
 * seedAxis (kind === 'dv', keyed by segment id).
 */
export function evaluateObjective(objective: Objective, c: Float64Array, controls: readonly ControlBinding[]): CostAndGradient {
  if (objective.type !== 'minimizeDeltaV') {
    // Exhaustive on the current union; future objectives extend here.
    throw new Error(`unsupported optimizer objective: ${String(objective.type)}`);
  }
  // Group the dv-component controls by their maneuver segment and form each |dv_S|.
  const groupSumSq = new Map<string, number>();
  for (let j = 0; j < controls.length; j++) {
    const sa = controls[j]!.seedAxis;
    if (!sa || sa.kind !== 'dv') continue;
    groupSumSq.set(sa.segment, (groupSumSq.get(sa.segment) ?? 0) + c[j]! * c[j]!);
  }
  const groupNorm = new Map<string, number>();
  let cost = 0;
  for (const [seg, sumSq] of groupSumSq) {
    const norm = Math.sqrt(sumSq);
    groupNorm.set(seg, norm);
    cost += norm;
  }
  const gradient = new Float64Array(controls.length);
  for (let j = 0; j < controls.length; j++) {
    const sa = controls[j]!.seedAxis;
    if (!sa || sa.kind !== 'dv') continue; // non-dv controls: zero cost gradient
    const norm = groupNorm.get(sa.segment) ?? 0;
    gradient[j] = c[j]! / Math.max(norm, DV_EPS);
  }
  return { cost, gradient };
}

/**
 * The analytic objective Hessian d2f/dc2 (n x n, row-major) used by the SQP step. For each
 * maneuver group the cost is the L2 norm |u| of its component controls; the Hessian of |u| is
 * (I - u u^T / |u|^2) / |u|, the standard norm Hessian (positive semidefinite, singular along
 * the u direction). Cross-group and non-dv blocks are zero.
 */
export function evaluateObjectiveHessian(objective: Objective, c: Float64Array, controls: readonly ControlBinding[]): Float64Array {
  if (objective.type !== 'minimizeDeltaV') {
    throw new Error(`unsupported optimizer objective: ${String(objective.type)}`);
  }
  const n = controls.length;
  const H = new Float64Array(n * n);
  const groups = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const sa = controls[j]!.seedAxis;
    if (!sa || sa.kind !== 'dv') continue;
    const arr = groups.get(sa.segment) ?? [];
    arr.push(j);
    groups.set(sa.segment, arr);
  }
  for (const idx of groups.values()) {
    let sumSq = 0;
    for (const j of idx) sumSq += c[j]! * c[j]!;
    const norm = Math.sqrt(sumSq);
    const inv = 1 / Math.max(norm, DV_EPS);
    const inv3 = inv * inv * inv;
    // Hess(|u|)_{ab} = delta_{ab}/|u| - u_a u_b / |u|^3.
    for (const a of idx) {
      for (const b of idx) {
        H[a * n + b] = (a === b ? inv : 0) - c[a]! * c[b]! * inv3;
      }
    }
  }
  return H;
}
