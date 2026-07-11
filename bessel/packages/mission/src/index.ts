// @bessel/mission: trajectory/maneuver design primitives (Astrogator-class). This
// first cut provides the Lambert boundary-value solver and impulsive maneuvers in
// the standard frames; the mission-control-sequence executor, differential
// correctors, and finite burns build on these. (STK_PARITY_SPEC §4.2.)

export { lambert, type LambertSolution, type Vec3 } from './lambert.ts';
export {
  frameBasis,
  applyImpulsiveManeuver,
  deltaVMagnitude,
  type CartesianState,
  type ManeuverFrame,
  type FrameBasis,
} from './maneuver.ts';
