// Public surface of the MCS executor and single-level differential corrector. Authors build
// an Mcs (the pure IR), validate it, then runMission against a MissionEnv that injects the
// SPICE-free dynamics. (STK_PARITY_SPEC §4.3.)

export type {
  Mcs,
  Segment,
  InitialStateSegment,
  PropagateSegment,
  ManeuverSegment,
  TargetSegment,
  SequenceSegment,
  StopSegment,
  StopCondition,
  KeplerianElements,
  ControlVar,
  ControlParam,
  Goal,
  GoalType,
  DcSettings,
  Objective,
  ObjectiveType,
  OptimizerMethod,
} from './segments.ts';
export { DEFAULT_DC_SETTINGS } from './segments.ts';

export type { MissionState, StateSample, SegmentResult, SegmentStatus, SegmentId, TdbSeconds } from './state.ts';
export { validateMcs } from './validate.ts';
export { runMcs, runMission, runSegment, type McsRun, type RunOpts } from './executor.ts';
export { createMissionEnv, type MissionEnv, type BodyDynamics } from './env.ts';
export { coe2rv, rv2coe, trueAnomalyOf, type OrbitElements, type RvPair } from './elements.ts';
export { vnbBasis, dvToInertial, type VnbBasis } from './frames.ts';
export { runFiniteBurn, G0_KM_S2, type FiniteBurnResult } from './finite-burn.ts';

export { runDifferentialCorrector, runTargetOptimizer, type DcReport, type PerGoalReport } from './corrector/solve.ts';
export { type OptimizerReport } from './corrector/optimize.ts';
export type { DcEvalContext, ResidualEval } from './corrector/residual.ts';

export {
  McsError,
  DcNotConvergedError,
  OptimizerNotConvergedError,
  SingularJacobianError,
  PropagationDivergedError,
  StopConditionNeverTriggeredError,
  NotImplementedError,
  MissingControlsOrGoalsError,
  DegenerateElementsError,
  DegenerateGeometryError,
  MissingInitialStateError,
  type PerGoalStatus,
} from './errors.ts';
