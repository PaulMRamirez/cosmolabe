// Typed, located errors for the MCS executor and differential corrector. All extend the
// propagator's IntegrationError (callers already catch it), and every error carries the
// segment path where it arose so a failure is explicit and located, never a silent
// wrong answer. Fail loudly (CLAUDE.md). (STK_PARITY_SPEC §4.3.)

import { IntegrationError } from '../errors.ts';
import type { GoalType } from './segments.ts';
import type { SegmentId } from './state.ts';

export class McsError extends IntegrationError {
  readonly segmentPath: readonly string[];
  constructor(message: string, segmentPath: readonly string[]) {
    super(segmentPath.length ? `${message} (at ${segmentPath.join(' / ')})` : message);
    this.name = 'McsError';
    this.segmentPath = segmentPath;
  }
}

/** Per-goal convergence detail attached to a corrector failure. */
export interface PerGoalStatus {
  readonly type: GoalType;
  readonly achieved: number;
  readonly desired: number;
  readonly residual: number;
  readonly satisfied: boolean;
}

/** The differential corrector hit its iteration cap without meeting every goal tolerance. */
export class DcNotConvergedError extends McsError {
  readonly iterations: number;
  readonly controls: Float64Array;
  readonly residuals: Float64Array;
  readonly perGoal: readonly PerGoalStatus[];
  constructor(
    segmentPath: readonly string[],
    iterations: number,
    controls: Float64Array,
    residuals: Float64Array,
    perGoal: readonly PerGoalStatus[],
  ) {
    super(`differential corrector did not converge in ${iterations} iterations`, segmentPath);
    this.name = 'DcNotConvergedError';
    this.iterations = iterations;
    this.controls = controls;
    this.residuals = residuals;
    this.perGoal = perGoal;
  }
}

/** The OPTIMIZER-mode Target could not reach a feasible optimum within its sweep budget. */
export class OptimizerNotConvergedError extends McsError {
  readonly iterations: number;
  readonly controls: Float64Array;
  constructor(segmentPath: readonly string[], iterations: number, controls: Float64Array, detail: string) {
    super(`optimizer did not converge in ${iterations} sweeps: ${detail}`, segmentPath);
    this.name = 'OptimizerNotConvergedError';
    this.iterations = iterations;
    this.controls = controls;
  }
}

/** The Jacobian was rank-deficient or ill-conditioned past the limit. */
export class SingularJacobianError extends McsError {
  readonly cond: number;
  readonly nullControl?: SegmentId;
  readonly nullGoal?: GoalType;
  constructor(segmentPath: readonly string[], cond: number, nullControl?: SegmentId, nullGoal?: GoalType) {
    super(`singular or ill-conditioned Jacobian (cond ~ ${cond.toExponential(2)})`, segmentPath);
    this.name = 'SingularJacobianError';
    this.cond = cond;
    this.nullControl = nullControl;
    this.nullGoal = nullGoal;
  }
}

/** A propagation produced a non-finite state. */
export class PropagationDivergedError extends McsError {
  constructor(segmentPath: readonly string[], detail: string) {
    super(`propagation diverged: ${detail}`, segmentPath);
    this.name = 'PropagationDivergedError';
  }
}

/** A goal-bearing Propagate hit only its duration backstop, so the goal could not be measured. */
export class StopConditionNeverTriggeredError extends McsError {
  readonly segment: SegmentId;
  constructor(segmentPath: readonly string[], segment: SegmentId) {
    super(`stop condition never triggered for segment "${segment}" (reached the duration backstop)`, segmentPath);
    this.name = 'StopConditionNeverTriggeredError';
    this.segment = segment;
  }
}

/** A feature reserved for a later phase was requested. */
export class NotImplementedError extends McsError {
  constructor(segmentPath: readonly string[], feature: string) {
    super(`not implemented in this phase: ${feature}`, segmentPath);
    this.name = 'NotImplementedError';
  }
}

/** A Target segment has no controls, or more goals than controls without weights. */
export class MissingControlsOrGoalsError extends McsError {
  constructor(segmentPath: readonly string[], detail: string) {
    super(`under-specified corrector: ${detail}`, segmentPath);
    this.name = 'MissingControlsOrGoalsError';
  }
}

/** Element conversion hit a degenerate (parabolic/rectilinear) orbit. */
export class DegenerateElementsError extends McsError {
  constructor(segmentPath: readonly string[], detail: string) {
    super(`degenerate orbital elements: ${detail}`, segmentPath);
    this.name = 'DegenerateElementsError';
  }
}

/** A frame/geometry construction was degenerate (e.g. zero velocity for a VNB basis). */
export class DegenerateGeometryError extends McsError {
  constructor(segmentPath: readonly string[], detail: string) {
    super(`degenerate geometry: ${detail}`, segmentPath);
    this.name = 'DegenerateGeometryError';
  }
}

/** The sequence reached a propagation/maneuver before any InitialState seeded the state. */
export class MissingInitialStateError extends McsError {
  constructor(segmentPath: readonly string[]) {
    super('no InitialState seeded before a segment that needs an input state', segmentPath);
    this.name = 'MissingInitialStateError';
  }
}
