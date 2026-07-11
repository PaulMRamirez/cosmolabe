// The Mission Control Sequence intermediate representation: a pure, JSON-round-trippable
// discriminated union (every field readonly, no methods or closures), so an MCS is data
// that can be authored, serialized, and replayed. Execution lives in executor.ts; this
// module is only the shape. (STK_PARITY_SPEC §4.3.)

import type { Vec3 } from '@bessel/spice';
import type { SegmentId, TdbSeconds } from './state.ts';
import type { IntegratorOptions } from '../integrator.ts';

/** Classical (osculating) element set for seeding an InitialState, angles in radians. */
export interface KeplerianElements {
  readonly sma: number;
  readonly ecc: number;
  readonly inc: number;
  readonly raan: number;
  readonly argp: number;
  readonly trueAnomaly: number;
}

export type Segment =
  | InitialStateSegment
  | PropagateSegment
  | ManeuverSegment
  | TargetSegment
  | SequenceSegment
  | StopSegment;

export interface InitialStateSegment {
  readonly kind: 'InitialState';
  readonly id: SegmentId;
  readonly epoch: TdbSeconds;
  readonly centralBody: number;
  readonly mass: number;
  readonly frame: 'J2000';
  readonly coord:
    | { readonly type: 'Cartesian'; readonly r: Vec3; readonly v: Vec3 }
    | { readonly type: 'Keplerian'; readonly el: KeplerianElements };
}

/** A propagation stop trigger; compiled to a terminal EventSpec by stop.ts. */
export type StopCondition =
  | { readonly type: 'Duration'; readonly value: number }
  | { readonly type: 'Epoch'; readonly value: TdbSeconds }
  | { readonly type: 'Apoapsis' }
  | { readonly type: 'Periapsis' }
  | { readonly type: 'Altitude'; readonly value: number; readonly crossing: 'rising' | 'falling' }
  | { readonly type: 'Radius'; readonly value: number; readonly crossing?: 'rising' | 'falling' }
  | { readonly type: 'TrueAnomaly'; readonly value: number };

export interface PropagateSegment {
  readonly kind: 'Propagate';
  readonly id: SegmentId;
  /** MVP: 'TwoBody'. 'PointMassNBody' requires the env to supply an n-body force model. */
  readonly model: 'TwoBody' | 'PointMassNBody';
  /** Always-on duration backstop (s) so a propagation can never run unbounded. */
  readonly maxDuration: number;
  /** Output sampling step (s); defaults to maxDuration / 64. */
  readonly sampleStep?: number;
  readonly stop: readonly StopCondition[];
  readonly tolerances?: IntegratorOptions;
}

export interface ManeuverSegment {
  readonly kind: 'Maneuver';
  readonly id: SegmentId;
  /** 'Impulsive' adds the delta-v instantly; 'Finite' propagates a constant-thrust arc. */
  readonly mode: 'Impulsive' | 'Finite';
  readonly attitude: 'VNB' | 'Inertial';
  /**
   * For an impulsive burn: the delta-v components in the `attitude` frame (km/s). For a
   * finite burn: the thrust DIRECTION in the `attitude` frame (only its direction is used,
   * frozen at ignition; magnitude/duration come from thrustN/duration below).
   */
  readonly dv: Vec3;
  /** Specific impulse (s). Required for a finite burn; rejected on an impulsive burn. */
  readonly isp?: number;
  /** Finite burn: thrust magnitude (N). */
  readonly thrustN?: number;
  /** Finite burn: burn duration (s). */
  readonly duration?: number;
}

export interface TargetSegment {
  readonly kind: 'Target';
  readonly id: SegmentId;
  readonly corrector: 'DifferentialCorrector';
  readonly children: readonly Segment[];
  readonly controls: readonly ControlVar[];
  readonly goals: readonly Goal[];
  readonly settings?: Partial<DcSettings>;
  /**
   * Optional optimization objective. When set, the Target runs in OPTIMIZER mode: it satisfies
   * the goals AND minimizes the scalar objective over the (redundant) control variables, instead
   * of merely root-finding the goals. Omit for plain differential-correction behavior.
   */
  readonly objective?: Objective;
}

export interface SequenceSegment {
  readonly kind: 'Sequence';
  readonly id: SegmentId;
  readonly children: readonly Segment[];
}

export interface StopSegment {
  readonly kind: 'Stop';
  readonly id: SegmentId;
}

export interface Mcs {
  readonly version: 1;
  readonly root: SequenceSegment;
}

/** What a differential-corrector control variable may vary. */
export type ControlParam =
  | 'Maneuver.dv.x'
  | 'Maneuver.dv.y'
  | 'Maneuver.dv.z'
  | 'Maneuver.duration'
  | 'Maneuver.thrustN'
  | 'Propagate.maxDuration'
  | 'InitialState.epoch'
  | 'InitialState.r.x'
  | 'InitialState.r.y'
  | 'InitialState.r.z'
  | 'InitialState.v.x'
  | 'InitialState.v.y'
  | 'InitialState.v.z';

export interface ControlVar {
  readonly segment: SegmentId;
  readonly param: ControlParam;
  readonly initial?: number;
  /** Finite-difference perturbation magnitude (in the control's units). */
  readonly perturbation: number;
  /** Trust-region clamp on a single Newton step (optional). */
  readonly maxStep?: number;
  /** Nondimensionalizing scale for the control (defaults to max(|value|, 1)). */
  readonly scale?: number;
}

/** What a differential-corrector goal measures at its evaluation segment. */
export type GoalType =
  | 'Radius'
  | 'Altitude'
  | 'RadiusOfApoapsis'
  | 'RadiusOfPeriapsis'
  | 'SMA'
  | 'Ecc'
  | 'Inc'
  | 'RAAN'
  | 'ArgP'
  | 'FlightPathAngle'
  | 'Position.x'
  | 'Position.y'
  | 'Position.z'
  | 'Velocity.x'
  | 'Velocity.y'
  | 'Velocity.z'
  | 'Epoch'
  | 'TimeOfFlight';

export interface Goal {
  /** Segment id whose output state is measured, or 'End' for the final state (default). */
  readonly evalAt: SegmentId | 'End';
  readonly type: GoalType;
  readonly desired: number;
  readonly tolerance: number;
  readonly weight?: number;
  /** Required for Altitude goals (km), to convert radius to altitude. */
  readonly bodyRadius?: number;
}

/**
 * A scalar objective an OPTIMIZER-mode Target minimizes subject to its goals.
 *   - 'minimizeDeltaV' minimizes the total impulsive delta-v magnitude summed over the burns the
 *     control variables drive (the sum of the per-Maneuver |dv|). Fuel-optimal targeting.
 */
export type ObjectiveType = 'minimizeDeltaV';

/**
 * The optimization method an OPTIMIZER-mode Target uses.
 *   - 'projectedGradient' (default): a first-order reduced-gradient descent with constraint
 *     restoration (Rosen gradient projection). Robust, but only linearly convergent.
 *   - 'sqp': a second-order sequential-quadratic-programming step that solves the
 *     equality-constrained KKT system with the analytic objective Hessian, giving an
 *     active-set / quadratic-convergence advantage (far fewer iterations near the optimum).
 */
export type OptimizerMethod = 'projectedGradient' | 'sqp';

export interface Objective {
  readonly type: ObjectiveType;
  /** The optimization method (default 'projectedGradient'). */
  readonly method?: OptimizerMethod;
}

export interface DcSettings {
  readonly maxIterations: number;
  readonly useCentralDifference: boolean;
  readonly perturbationRel: number;
  readonly trustRegion: boolean;
  readonly damping: 'none' | 'armijo';
  readonly conditionLimit: number;
  readonly useStm: boolean;
  /**
   * Optimizer-only knobs (ignored in plain DC mode). `optimizerMaxIterations` caps the outer
   * projected-gradient sweeps; `optimizerTolerance` is the convergence threshold on the
   * projected (reduced) cost-gradient norm. Defaults applied in DEFAULT_DC_SETTINGS.
   */
  readonly optimizerMaxIterations: number;
  readonly optimizerTolerance: number;
}

export const DEFAULT_DC_SETTINGS: DcSettings = {
  maxIterations: 25,
  useCentralDifference: false,
  perturbationRel: 1e-6,
  trustRegion: true,
  damping: 'armijo',
  conditionLimit: 1e12,
  useStm: true,
  optimizerMaxIterations: 60,
  optimizerTolerance: 1e-8,
};
