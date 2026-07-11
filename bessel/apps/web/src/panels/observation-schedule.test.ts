import { describe, it, expect } from 'vitest';
import {
  buildObservationSchedule,
  ObservationScheduleError,
  type ScheduleTarget,
  type ScheduleDynamics,
} from './observation-schedule.ts';
import { eigenAxisSlew, type Quaternion } from '@bessel/attitude';

// The conflict-free schedule builder is pure (analysis-UX Phase 3): greedy earliest-feasible across
// targets, respecting the eigen-axis slew gap between consecutive targets and a minimum dwell. These
// tests pin the feasible ordering, the slew-gap enforcement, the conflict reporting, and fail-loud.

const identity: Quaternion = [1, 0, 0, 0];
// A 90 deg rotation about +X.
const ninetyAboutX: Quaternion = [Math.SQRT1_2, Math.SQRT1_2, 0, 0];

const dynamics: ScheduleDynamics = { maxRateDegPerSec: 1, maxAccelDegPerSec2: 0.25, minDwellSec: 0 };

/** The eigen-axis slew duration (s) between two attitudes at the test dynamics, for gap arithmetic. */
function slewDur(from: Quaternion, to: Quaternion): number {
  return eigenAxisSlew(from, to, dynamics.maxRateDegPerSec / (180 / Math.PI), dynamics.maxAccelDegPerSec2 / (180 / Math.PI)).duration;
}

describe('buildObservationSchedule', () => {
  it('places non-overlapping windows in earliest-feasible order across targets', () => {
    const targets: ScheduleTarget[] = [
      { name: 'B', windows: [[300, 400]], attitude: identity },
      { name: 'A', windows: [[0, 100]], attitude: identity },
      { name: 'C', windows: [[500, 600]], attitude: identity },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.unscheduled).toEqual([]);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['A', 'B', 'C']);
    // The slots are ordered and non-overlapping.
    expect(sched.slots[0]!.stop).toBeLessThanOrEqual(sched.slots[1]!.start);
    expect(sched.slots[1]!.stop).toBeLessThanOrEqual(sched.slots[2]!.start);
    // All same attitude: no slew between any slot.
    for (const s of sched.slots) expect(s.slewFromPrevSec).toBeCloseTo(0, 9);
  });

  it('respects the slew gap: a second target whose window is reachable after the slew is placed', () => {
    const gap = slewDur(identity, ninetyAboutX);
    const targets: ScheduleTarget[] = [
      { name: 'first', windows: [[0, 100]], attitude: identity },
      // The second target's window starts comfortably after the first slot's end + the slew duration.
      { name: 'second', windows: [[100 + gap + 50, 300]], attitude: ninetyAboutX },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.unscheduled).toEqual([]);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['first', 'second']);
    const second = sched.slots[1]!;
    expect(second.slewFromPrevDeg).toBeCloseTo(90, 4);
    expect(second.slewFromPrevSec).toBeCloseTo(gap, 6);
    // The second slot starts no earlier than the first's end plus the slew.
    expect(second.start).toBeGreaterThanOrEqual(sched.slots[0]!.stop + gap - 1e-6);
  });

  it('clamps a placed start up to the slew-arrival time when the window opens too early', () => {
    const gap = slewDur(identity, ninetyAboutX);
    const targets: ScheduleTarget[] = [
      { name: 'first', windows: [[0, 100]], attitude: identity },
      // The window opens at 100 (right at the first slot's end), before the slew can finish.
      { name: 'second', windows: [[100, 1000]], attitude: ninetyAboutX },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['first', 'second']);
    // The second slot's start is clamped up to 100 + slew, not the raw window open at 100.
    expect(sched.slots[1]!.start).toBeCloseTo(100 + gap, 4);
  });

  it('reports a slew conflict: the second target window is too brief once the slew is subtracted', () => {
    const gap = slewDur(identity, ninetyAboutX);
    const targets: ScheduleTarget[] = [
      { name: 'first', windows: [[0, 100]], attitude: identity },
      // The window opens at 100 and only lasts a hair beyond it: after the slew there is no dwell left.
      { name: 'second', windows: [[100, 100 + gap - 1]], attitude: ninetyAboutX },
    ];
    const sched = buildObservationSchedule(targets, { ...dynamics, minDwellSec: 10 });
    expect(sched.slots.map((s) => s.targetName)).toEqual(['first']);
    expect(sched.unscheduled.map((u) => u.targetName)).toEqual(['second']);
    expect(sched.unscheduled[0]!.reason).toContain('conflict');
  });

  it('reports a target with no feasible window as unscheduled', () => {
    const targets: ScheduleTarget[] = [
      { name: 'visible', windows: [[0, 100]], attitude: identity },
      { name: 'never', windows: [], attitude: identity },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['visible']);
    expect(sched.unscheduled[0]).toMatchObject({ targetName: 'never' });
    expect(sched.unscheduled[0]!.reason).toContain('no feasible');
  });

  it('reports a window shorter than the minimum dwell as unscheduled', () => {
    const targets: ScheduleTarget[] = [
      { name: 'brief', windows: [[0, 30]], attitude: identity },
    ];
    const sched = buildObservationSchedule(targets, { ...dynamics, minDwellSec: 60 });
    expect(sched.slots).toEqual([]);
    expect(sched.unscheduled[0]!.reason).toContain('minimum dwell');
  });

  it('schedules each target at most once even with multiple windows', () => {
    const targets: ScheduleTarget[] = [
      { name: 'multi', windows: [[0, 100], [200, 300]], attitude: identity },
      { name: 'other', windows: [[400, 500]], attitude: identity },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.slots.filter((s) => s.targetName === 'multi')).toHaveLength(1);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['multi', 'other']);
  });

  it('fails loud on non-positive dynamics or a negative dwell', () => {
    const t: ScheduleTarget[] = [{ name: 'A', windows: [[0, 100]], attitude: identity }];
    expect(() => buildObservationSchedule(t, { ...dynamics, maxRateDegPerSec: 0 })).toThrow(ObservationScheduleError);
    expect(() => buildObservationSchedule(t, { ...dynamics, maxAccelDegPerSec2: 0 })).toThrow(ObservationScheduleError);
    expect(() => buildObservationSchedule(t, { ...dynamics, minDwellSec: -1 })).toThrow(ObservationScheduleError);
  });

  it('uses an explicit unavailableReason to report a target unscheduled without aborting the run', () => {
    const targets: ScheduleTarget[] = [
      { name: 'good', windows: [[0, 100]], attitude: identity },
      { name: 'bad', windows: [], attitude: identity, unavailableReason: 'geometry failed: spkpos error' },
    ];
    const sched = buildObservationSchedule(targets, dynamics);
    expect(sched.slots.map((s) => s.targetName)).toEqual(['good']);
    expect(sched.unscheduled).toEqual([{ targetName: 'bad', reason: 'geometry failed: spkpos error' }]);
  });

  it('returns an empty schedule for no targets', () => {
    expect(buildObservationSchedule([], dynamics)).toEqual({ slots: [], unscheduled: [] });
  });
});
