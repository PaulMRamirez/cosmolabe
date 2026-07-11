// @bessel/attitude: pointing laws and slews. Two-vector attitude profiles reuse
// CSPICE twovec for the orthonormalization; the eigen-axis slew is pure quaternion
// kinematics with a trapezoidal rate profile. Core layer: depends only on
// @bessel/spice. (STK_PARITY_SPEC §4.6.)

import type { Mat3, SpiceEngine } from '@bessel/spice';

/** A SPICE quaternion [w, x, y, z] (scalar first). */
export type Quaternion = readonly [number, number, number, number];

const qdot = (a: Quaternion, b: Quaternion): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

function normalize(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Shortest-path spherical linear interpolation between two quaternions. */
export function slerp(from: Quaternion, to: Quaternion, t: number): Quaternion {
  const a = normalize(from);
  let b = normalize(to);
  let d = qdot(a, b);
  if (d < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    d = -d;
  }
  if (d > 0.9995) {
    return normalize([
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
      a[3] + t * (b[3] - a[3]),
    ]);
  }
  const theta0 = Math.acos(d);
  const theta = theta0 * t;
  const s = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / s;
  const s1 = Math.sin(theta) / s;
  return [a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1, a[3] * s0 + b[3] * s1];
}

export interface Slew {
  /** Total slew angle (rad). */
  readonly angle: number;
  /** Total slew duration (s). */
  readonly duration: number;
  /** Orientation at time t in [0, duration]. */
  readonly at: (t: number) => Quaternion;
}

/**
 * Eigen-axis slew between two orientations honoring a maximum angular rate and
 * acceleration: a trapezoidal (or triangular, if the rate is never reached) profile
 * along the shortest-arc eigen axis.
 */
export function eigenAxisSlew(
  from: Quaternion,
  to: Quaternion,
  maxRate: number,
  maxAccel: number,
): Slew {
  const angle = 2 * Math.acos(Math.min(1, Math.abs(qdot(normalize(from), normalize(to)))));
  const ta = maxRate / maxAccel; // time to reach max rate
  const angleRamp = maxAccel * ta * ta; // angle covered by symmetric accel + decel
  let duration: number;
  let traversed: (t: number) => number; // angle covered by time t
  if (angle <= angleRamp) {
    const tHalf = Math.sqrt(angle / maxAccel);
    duration = 2 * tHalf;
    traversed = (t) => {
      if (t <= tHalf) return 0.5 * maxAccel * t * t;
      const td = t - tHalf;
      const peak = maxAccel * tHalf;
      return 0.5 * maxAccel * tHalf * tHalf + peak * td - 0.5 * maxAccel * td * td;
    };
  } else {
    const tc = (angle - angleRamp) / maxRate;
    duration = 2 * ta + tc;
    traversed = (t) => {
      if (t <= ta) return 0.5 * maxAccel * t * t;
      if (t <= ta + tc) return 0.5 * maxAccel * ta * ta + maxRate * (t - ta);
      const td = t - ta - tc;
      return 0.5 * maxAccel * ta * ta + maxRate * tc + maxRate * td - 0.5 * maxAccel * td * td;
    };
  }
  return {
    angle,
    duration,
    at: (t) => {
      const clamped = Math.max(0, Math.min(duration, t));
      const frac = angle > 0 ? Math.max(0, Math.min(1, traversed(clamped) / angle)) : 1;
      return slerp(from, to, frac);
    },
  };
}

export interface TwoVectorAxes {
  /** Body axis (1=X, 2=Y, 3=Z) aligned exactly to the primary direction. */
  readonly primaryAxis?: number;
  /** Body axis placed in the primary-secondary plane. */
  readonly secondaryAxis?: number;
}

/**
 * Nadir-pointing attitude: the primary body axis points from the observer to the
 * body center (nadir), with a secondary axis constrained toward the velocity.
 * Returns the J2000 -> body rotation at et.
 */
export async function nadirAttitude(
  spice: SpiceEngine,
  observer: string,
  body: string,
  et: number,
  axes: TwoVectorAxes = {},
): Promise<Mat3> {
  const toBody = await spice.spkpos(body, et, 'J2000', 'NONE', observer);
  const obs = await spice.spkezr(observer, et, 'J2000', 'NONE', body);
  return spice.twovec(toBody.position, axes.primaryAxis ?? 3, obs.velocity, axes.secondaryAxis ?? 1);
}

/**
 * Sun-pointing attitude: the primary body axis points at the Sun, with a secondary
 * axis constrained toward the given reference direction's body (default the central
 * body, for a nadir-ish secondary). Returns the J2000 -> body rotation at et.
 */
export async function sunPointingAttitude(
  spice: SpiceEngine,
  observer: string,
  secondaryTarget: string,
  et: number,
  axes: TwoVectorAxes = {},
): Promise<Mat3> {
  const toSun = await spice.spkpos('SUN', et, 'J2000', 'NONE', observer);
  const toSecondary = await spice.spkpos(secondaryTarget, et, 'J2000', 'NONE', observer);
  return spice.twovec(toSun.position, axes.primaryAxis ?? 3, toSecondary.position, axes.secondaryAxis ?? 1);
}

export {
  angularSeparationRad,
  withinKeepOut,
  keepOutWindow,
  type KeepOutRequest,
} from './keep-out.ts';

export {
  attitudeHistory,
  quaternionToMatrix,
  AttitudeHistoryError,
  type AttitudeRecord,
  type AttitudeHistory,
} from './ck.ts';
