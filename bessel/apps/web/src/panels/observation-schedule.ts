// The multi-target observation-schedule builder (analysis-UX Phase 3, observation planner, pulled
// up from P3 per the critique). Given several observation targets, each with its feasible in-FOV +
// constraint windows and the attitude the sensor holds while observing it, build a CONFLICT-FREE
// SCHEDULE: an ordered set of non-overlapping observation slots across targets where the eigen-axis
// attitude SLEW between consecutive scheduled targets fits in the gap between them (reusing the
// Phase-2 slew model, @bessel/attitude). PURE: no SPICE, no DOM, no Math.random / Date.now; the
// engine op resolves each target's windows + attitude and supplies the dynamics, this module owns
// the greedy earliest-feasible reduction so it is unit-tested directly. Fails loud on bad dynamics.

import { eigenAxisSlew, type Quaternion } from '@bessel/attitude';
import { RAD2DEG } from '../angles.ts';

/** A located, typed error for a schedule request the builder cannot evaluate (fail loudly). */
export class ObservationScheduleError extends Error {
  override readonly name = 'ObservationScheduleError';
  constructor(message: string) {
    super(`observation-schedule: ${message}`);
  }
}

/** One observation target the schedule may place: its name, the feasible windows it can be observed
 *  in (post in-FOV + constraint, ET seconds), and the attitude the sensor holds while observing it. */
export interface ScheduleTarget {
  /** The target body/object name (the schedule + unscheduled rows key off this). */
  readonly name: string;
  /** Feasible observation windows (in-FOV + constraint surviving), each [start, stop] ET seconds. */
  readonly windows: readonly (readonly [number, number])[];
  /** Attitude (J2000 quaternion [w,x,y,z]) the sensor holds while observing this target. */
  readonly attitude: Quaternion;
  /** An explicit unschedulable reason (e.g. an unresolved body / per-target geometry failure) that
   *  overrides the derived reason, marking the target unscheduled without aborting the whole run. */
  readonly unavailableReason?: string;
}

/** Eigen-axis slew dynamics gating the inter-target transition. */
export interface ScheduleDynamics {
  readonly maxRateDegPerSec: number;
  readonly maxAccelDegPerSec2: number;
  /** Minimum dwell (s) a scheduled slot must hold: a feasible window shorter than this is skipped. */
  readonly minDwellSec: number;
}

/** One placed observation slot in the conflict-free schedule. */
export interface ScheduledSlot {
  readonly targetName: string;
  /** The observation start/stop (ET seconds): start is clamped to the slew-arrival time. */
  readonly start: number;
  readonly stop: number;
  /** The eigen-axis slew angle (deg) from the previous slot's attitude (0 for the first slot). */
  readonly slewFromPrevDeg: number;
  /** The slew duration (s) from the previous slot's attitude (0 for the first slot). */
  readonly slewFromPrevSec: number;
}

/** A target that could not be placed, with a located reason. */
export interface UnscheduledTarget {
  readonly targetName: string;
  /** Why the target could not be scheduled (no feasible window, dwell too short, or slew conflict). */
  readonly reason: string;
}

/** The conflict-free schedule: the ordered placed slots plus the targets that could not be placed. */
export interface ObservationSchedule {
  readonly slots: readonly ScheduledSlot[];
  readonly unscheduled: readonly UnscheduledTarget[];
}

/** Eigen-axis slew angle (deg) + duration (s) between two attitudes under the dynamics. */
interface SlewInfo {
  readonly angleDeg: number;
  readonly durationSec: number;
}

function slewBetween(
  from: Quaternion,
  to: Quaternion,
  maxRateDegPerSec: number,
  maxAccelDegPerSec2: number,
): SlewInfo {
  const slew = eigenAxisSlew(from, to, maxRateDegPerSec / RAD2DEG, maxAccelDegPerSec2 / RAD2DEG);
  return { angleDeg: slew.angle * RAD2DEG, durationSec: slew.duration };
}

/**
 * Build a conflict-free multi-target observation schedule by GREEDY earliest-feasible placement.
 *
 * The scheduler walks forward in time: at each step it picks, among the not-yet-scheduled targets,
 * the one whose earliest feasible observation start (a window that (a) lasts at least minDwell, and
 * (b) can be reached after the previous slot ends plus the eigen-axis slew from the previous target)
 * is soonest. That slot is placed (its start clamped to the slew-arrival time), the cursor advances,
 * and the loop repeats until no target can be placed. Each target is scheduled at most once; targets
 * with no window long enough, or whose every reachable window is consumed by the slew, are reported
 * as unscheduled with a located reason. Deterministic and pure (ties break by input order, then by
 * earliest window). Fails loud on non-positive dynamics.
 */
export function buildObservationSchedule(
  targets: readonly ScheduleTarget[],
  dynamics: ScheduleDynamics,
): ObservationSchedule {
  if (!(dynamics.maxRateDegPerSec > 0)) {
    throw new ObservationScheduleError(`max rate must be > 0 deg/s, got ${dynamics.maxRateDegPerSec}`);
  }
  if (!(dynamics.maxAccelDegPerSec2 > 0)) {
    throw new ObservationScheduleError(`max accel must be > 0 deg/s^2, got ${dynamics.maxAccelDegPerSec2}`);
  }
  if (!(dynamics.minDwellSec >= 0)) {
    throw new ObservationScheduleError(`min dwell must be >= 0 s, got ${dynamics.minDwellSec}`);
  }

  const slots: ScheduledSlot[] = [];
  const remaining = targets.map((t, i) => ({ target: t, index: i }));
  // The cursor: the time the sensor is free, and the attitude it currently holds. Before the first
  // slot there is no prior attitude, so the first placement has a zero slew (no transition).
  let cursor = -Infinity;
  let lastAttitude: Quaternion | null = null;

  // Place slots until no remaining target yields a feasible start at or after the cursor.
  for (;;) {
    let best: {
      remIdx: number;
      start: number;
      stop: number;
      slewAngleDeg: number;
      slewDurationSec: number;
    } | null = null;

    for (let r = 0; r < remaining.length; r++) {
      const { target } = remaining[r]!;
      const slew: SlewInfo = lastAttitude
        ? slewBetween(lastAttitude, target.attitude, dynamics.maxRateDegPerSec, dynamics.maxAccelDegPerSec2)
        : { angleDeg: 0, durationSec: 0 };
      // The earliest moment this target may begin: the cursor plus the slew to reach its attitude.
      const earliest = cursor === -Infinity ? -Infinity : cursor + slew.durationSec;
      const placed = earliestFeasibleStart(target.windows, earliest, dynamics.minDwellSec);
      if (!placed) continue;
      // Prefer the soonest feasible start; ties break by the smaller input index (stable, ordered).
      if (!best || placed.start < best.start) {
        best = {
          remIdx: r,
          start: placed.start,
          stop: placed.stop,
          slewAngleDeg: slew.angleDeg,
          slewDurationSec: slew.durationSec,
        };
      }
    }

    if (!best) break;
    const chosen = remaining[best.remIdx]!;
    slots.push({
      targetName: chosen.target.name,
      start: best.start,
      stop: best.stop,
      slewFromPrevDeg: best.slewAngleDeg,
      slewFromPrevSec: best.slewDurationSec,
    });
    cursor = best.stop;
    lastAttitude = chosen.target.attitude;
    remaining.splice(best.remIdx, 1);
  }

  // Anything still remaining could not be placed: report a located reason for each.
  const unscheduled: UnscheduledTarget[] = remaining.map(({ target }) => ({
    targetName: target.name,
    reason: unschedulableReason(target, dynamics),
  }));

  return { slots, unscheduled };
}

/** The earliest feasible [start, stop] for a target given the earliest allowed start (after the slew)
 *  and the minimum dwell: the soonest window that, clamped to `earliest`, still leaves >= minDwell of
 *  observation. Returns null when no window qualifies. Windows are scanned in their given order. */
function earliestFeasibleStart(
  windows: readonly (readonly [number, number])[],
  earliest: number,
  minDwellSec: number,
): { start: number; stop: number } | null {
  let bestStart = Infinity;
  let bestStop = Infinity;
  for (const [wStart, wStop] of windows) {
    const start = Math.max(wStart, earliest === -Infinity ? wStart : earliest);
    if (start > wStop) continue; // the window ends before we could arrive
    if (wStop - start < minDwellSec) continue; // not enough dwell left after the slew
    if (start < bestStart) {
      bestStart = start;
      bestStop = wStop;
    }
  }
  return Number.isFinite(bestStart) ? { start: bestStart, stop: bestStop } : null;
}

/** A located reason a target could not be placed: an explicit per-target geometry failure (e.g. an
 *  unresolved body), no window at all, none long enough for the dwell, or every reachable window was
 *  consumed by the slew/conflict with earlier slots. */
function unschedulableReason(target: ScheduleTarget, dynamics: ScheduleDynamics): string {
  if (target.unavailableReason) return target.unavailableReason;
  if (target.windows.length === 0) return 'no feasible in-FOV / constraint window';
  const longest = target.windows.reduce((m, [s, e]) => Math.max(m, e - s), 0);
  if (longest < dynamics.minDwellSec) {
    return `no window long enough for the ${dynamics.minDwellSec} s minimum dwell (longest ${longest.toFixed(0)} s)`;
  }
  return 'conflict: every reachable window overlaps an earlier slot or its slew gap';
}
