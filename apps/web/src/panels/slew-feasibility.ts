// The slew-feasibility decision (analysis-UX Phase 2, observation-planner journey). Given two
// consecutive in-FOV/access windows and the spacecraft attitude the sensor must hold during each,
// does the eigen-axis slew between the two pointings FIT in the gap between the windows? PURE: the
// decision is eigenAxisSlew(q0, q1, rate, accel).duration <= gap, with the gap being the time from
// the end of the first window to the start of the second. No SPICE, no DOM, no Math.random/Date.now;
// the engine op resolves the two pointings to quaternions and supplies the window pair, this module
// owns the pure fits/does-not-fit reduction so it is unit-tested directly against @bessel/attitude.

import { eigenAxisSlew, type Quaternion } from '@bessel/attitude';
import { RAD2DEG } from '../angles.ts';

/** A located, typed error for a feasibility request the decision cannot evaluate (fail loudly). */
export class SlewFeasibilityError extends Error {
  override readonly name = 'SlewFeasibilityError';
  constructor(message: string) {
    super(`slew-feasibility: ${message}`);
  }
}

/** The two consecutive windows the slew bridges, each with the attitude held during it. The first
 *  window ends, the spacecraft slews, then the second window begins; the gap is t1Start - t0Stop. */
export interface SlewWindowPair {
  /** [start, stop] of the first (from) window, ET seconds. */
  readonly firstWindow: readonly [number, number];
  /** [start, stop] of the second (to) window, ET seconds. */
  readonly secondWindow: readonly [number, number];
  /** Attitude (J2000 quaternion [w,x,y,z]) the sensor holds at the end of the first window. */
  readonly fromQuat: Quaternion;
  /** Attitude the sensor must reach by the start of the second window. */
  readonly toQuat: Quaternion;
}

/** Eigen-axis slew dynamics: the maximum angular rate and acceleration of the trapezoidal profile. */
export interface SlewDynamics {
  readonly maxRateDegPerSec: number;
  readonly maxAccelDegPerSec2: number;
}

/** The feasibility verdict: the slew angle/duration, the available gap, and whether it fits. */
export interface SlewFeasibility {
  /** Eigen-axis slew angle between the two pointings (deg). */
  readonly slewAngleDeg: number;
  /** Eigen-axis slew duration under the rate/accel profile (s). */
  readonly slewDurationSec: number;
  /** The inter-window gap (s): the time from the first window's end to the second's start. */
  readonly gapSec: number;
  /** Slack (s) = gap - duration; non-negative when the slew fits. */
  readonly slackSec: number;
  /** Whether the slew fits in the gap (duration <= gap). */
  readonly fits: boolean;
}

/**
 * Decide whether the attitude slew between two consecutive windows' pointings fits in the gap. The
 * gap is the second window's start minus the first window's end; the slew duration is the eigen-axis
 * trapezoidal-profile duration for the from->to quaternion change under the supplied rate/accel. The
 * slew fits when its duration does not exceed the gap. Fails loud on a non-positive rate/accel, or on
 * overlapping/out-of-order windows (a non-positive gap means there is no time to slew at all).
 */
export function decideSlewFeasibility(pair: SlewWindowPair, dynamics: SlewDynamics): SlewFeasibility {
  if (!(dynamics.maxRateDegPerSec > 0)) {
    throw new SlewFeasibilityError(`max rate must be > 0 deg/s, got ${dynamics.maxRateDegPerSec}`);
  }
  if (!(dynamics.maxAccelDegPerSec2 > 0)) {
    throw new SlewFeasibilityError(`max accel must be > 0 deg/s^2, got ${dynamics.maxAccelDegPerSec2}`);
  }
  const gapSec = pair.secondWindow[0] - pair.firstWindow[1];
  if (!(gapSec > 0)) {
    throw new SlewFeasibilityError(
      `the second window must start after the first ends; gap is ${gapSec.toFixed(1)} s (windows overlap or are out of order)`,
    );
  }
  const maxRateRad = dynamics.maxRateDegPerSec / RAD2DEG;
  const maxAccelRad = dynamics.maxAccelDegPerSec2 / RAD2DEG;
  const slew = eigenAxisSlew(pair.fromQuat, pair.toQuat, maxRateRad, maxAccelRad);
  const slewAngleDeg = slew.angle * RAD2DEG;
  const slewDurationSec = slew.duration;
  const slackSec = gapSec - slewDurationSec;
  return { slewAngleDeg, slewDurationSec, gapSec, slackSec, fits: slackSec >= 0 };
}
