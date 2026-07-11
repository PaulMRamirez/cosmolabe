// Pure geometry for the instrument-target-visibility tool (B22): the conic half-angle
// of an instrument FOV, the off-boresight angle of a target from a nadir-pointed
// sensor, and contiguous in-view intervals from a boolean sweep. Imported only by the
// lazy analysis op, so it stays out of the first-paint chunk; unit-tested directly.

import { offBoresightAngle, type Vec3 } from '@bessel/sensors';

type Vec3Tuple = readonly [number, number, number];

const toVec = (t: Vec3Tuple): Vec3 => ({ x: t[0], y: t[1], z: t[2] });
const sub = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Conic half-angle (rad): the largest off-boresight angle among the FOV boundary
 *  rays. A degenerate FOV with no bounds returns 0 (nothing is ever in view). */
export function fovHalfAngleRad(boresight: Vec3Tuple, bounds: readonly Vec3Tuple[]): number {
  const b = toVec(boresight);
  let max = 0;
  for (const ray of bounds) {
    const a = offBoresightAngle(toVec(ray), b);
    if (a > max) max = a;
  }
  return max;
}

/** Off-boresight angle (rad) of a target from a nadir-pointed sensor: the boresight is
 *  the direction from the spacecraft toward the center body (nadir); the line of sight
 *  is spacecraft -> target. Same heliocentric frame for all three positions. */
export function nadirOffAngleRad(
  scPos: Vec3Tuple,
  centerPos: Vec3Tuple,
  targetPos: Vec3Tuple,
): number {
  const nadir = sub(centerPos, scPos);
  const los = sub(targetPos, scPos);
  return offBoresightAngle(toVec(los), toVec(nadir));
}

/** The boresight pointing references the in-FOV sweep can compute from sampled geometry
 *  alone: nadir (toward the center body) or sun (toward the Sun). A target-tracking mode
 *  needs real attitude/CK wiring and is gated to a later phase. */
export type FovPointing = 'nadir' | 'sun';

/** Off-boresight angle (rad) of the observed target from a sensor pointed along `mode`.
 *  The boresight is the direction from the spacecraft toward the pointing reference (the
 *  center body for nadir, the Sun for sun); the line of sight is spacecraft -> target. All
 *  positions share the same frame. Generalizes nadirOffAngleRad to a selectable reference. */
export function pointingOffAngleRad(
  mode: FovPointing,
  scPos: Vec3Tuple,
  centerPos: Vec3Tuple,
  sunPos: Vec3Tuple,
  targetPos: Vec3Tuple,
): number {
  const reference = mode === 'sun' ? sunPos : centerPos;
  const boresight = sub(reference, scPos);
  const los = sub(targetPos, scPos);
  return offBoresightAngle(toVec(los), toVec(boresight));
}

/** Contiguous in-view intervals (et pairs) from a boolean sweep aligned with `times`.
 *  A run of true samples becomes [firstTrueEt, lastTrueEt]; isolated samples collapse
 *  to a zero-length interval, which figureOfMerit treats as a momentary access. */
export function intervalsFromFlags(
  times: readonly number[],
  flags: readonly boolean[],
): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < times.length; i += 1) {
    if (flags[i]) {
      if (start === null) start = times[i]!;
    } else if (start !== null) {
      out.push([start, times[i - 1]!]);
      start = null;
    }
  }
  if (start !== null) out.push([start, times[times.length - 1]!]);
  return out;
}
