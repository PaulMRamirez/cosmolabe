// Lower an editable Mission Control Sequence (the segment editor's EditableMcs) into the
// @bessel/propagator Mcs IR that runMission executes. Pure and headless: the first InitialState
// seeds a circular orbit, Propagate and Maneuver lower one-to-one, and a Target wraps the
// nearest preceding Maneuver as its differential-corrector control and drives the chosen goal at
// the end of an inner coast. Fails loudly with a located McsEditorError when the segment list is
// not lowerable. (analysis-UX Phase 1; STK_PARITY_SPEC §4.3.)

import type {
  Mcs,
  InitialStateSegment,
  PropagateSegment,
  ManeuverSegment,
  TargetSegment,
  ControlVar,
  Goal,
  GoalType,
} from '@bessel/propagator';
import type { EditableMcs, EditableSegment, EditableManeuver, EditableTarget } from './mcs-editor.ts';

// The Mission Control Sequence segment union, assembled from the concrete IR segment
// interfaces. (The bare `Segment` export of @bessel/propagator is the dense-integrator
// segment, a different type; the children of an MCS sequence are these.)
type McsChild = InitialStateSegment | PropagateSegment | ManeuverSegment | TargetSegment;

const EARTH_ID = 399;
const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;

/** A located validation error for an editable MCS that cannot lower to a runnable IR. */
export class McsEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McsEditorError';
  }
}

/** Map the editable goal type to the propagator GoalType (the desired stays in km). */
const GOAL_TYPE: Record<EditableTarget['goalType'], GoalType> = {
  Radius: 'Radius',
  SMA: 'SMA',
  RadiusOfApoapsis: 'RadiusOfApoapsis',
};

/**
 * Lower the editable segment list into the @bessel/propagator Mcs IR. The first InitialState
 * seeds a circular orbit at its altitude; Propagate and Maneuver lower one-to-one; a Target
 * wraps the nearest preceding Maneuver as its control (the prograde dv) and drives the chosen
 * goal at the end of the inner coast. Fails loudly with a located McsEditorError when the list
 * is not lowerable (no InitialState first, or a Target with no preceding Maneuver).
 */
export function compileEditableMcs(design: EditableMcs): Mcs {
  const segs = design.segments;
  const first = segs[0];
  if (!first || first.kind !== 'InitialState') {
    throw new McsEditorError('the sequence must start with an InitialState segment');
  }
  const r0 = EARTH_RE + Math.max(100, first.altitudeKm);
  const vCirc = Math.sqrt(EARTH_GM / r0);
  const children: McsChild[] = [
    {
      kind: 'InitialState',
      id: first.id,
      epoch: 0,
      centralBody: EARTH_ID,
      mass: 100,
      frame: 'J2000',
      coord: { type: 'Cartesian', r: { x: r0, y: 0, z: 0 }, v: { x: 0, y: vCirc, z: 0 } },
    },
  ];
  // Maneuvers consumed by a following Target (as that Target's tuned control) must not also
  // run as a top-level sibling, or the burn would be applied twice. Pre-mark them.
  const consumed = new Set<string>();
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (seg.kind === 'Target') {
      const burn = findPrecedingManeuver(segs, i);
      if (burn) consumed.add(burn.id);
    }
  }
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]!;
    if (seg.kind === 'Maneuver' && consumed.has(seg.id)) {
      // Owned by a downstream Target; emitted inside that Target's children, not here.
      continue;
    }
    if (seg.kind === 'Propagate') {
      const dur = Math.max(60, seg.durationSec);
      children.push({
        kind: 'Propagate',
        id: seg.id,
        model: 'TwoBody',
        maxDuration: dur,
        sampleStep: 60,
        stop: [{ type: 'Duration', value: dur }],
      });
    } else if (seg.kind === 'Maneuver') {
      const dv = Math.max(0, seg.dvKmS);
      children.push({ kind: 'Maneuver', id: seg.id, mode: 'Impulsive', attitude: 'VNB', dv: { x: dv, y: 0, z: 0 } });
    } else if (seg.kind === 'Target') {
      children.push(buildTarget(seg, segs, i, r0));
    }
    // InitialState segments after the first are ignored (only one seeds the state).
  }
  return { version: 1, root: { kind: 'Sequence', id: 'root', children } };
}

/** Build a Target IR node that tunes the nearest preceding Maneuver to the chosen goal. The
 *  Target coasts a half orbit and measures the goal at that inner coast. Fail loud if there is
 *  no preceding burn to tune (a corrector with no control is under-specified). */
function buildTarget(
  seg: EditableTarget,
  segs: readonly EditableSegment[],
  i: number,
  r0: number,
): TargetSegment {
  const burn = findPrecedingManeuver(segs, i);
  if (!burn) {
    throw new McsEditorError(`Target "${seg.id}" has no preceding Maneuver to control`);
  }
  const coastId = `${seg.id}-coast`;
  const control: ControlVar = {
    segment: burn.id,
    param: 'Maneuver.dv.x',
    initial: Math.max(0, burn.dvKmS),
    perturbation: 1e-3,
  };
  const goal: Goal = {
    evalAt: coastId,
    type: GOAL_TYPE[seg.goalType],
    desired: Math.max(r0, seg.desiredKm),
    tolerance: Math.max(1e-3, seg.toleranceKm),
  };
  return {
    kind: 'Target',
    id: seg.id,
    corrector: 'DifferentialCorrector',
    controls: [control],
    goals: [goal],
    children: [
      { kind: 'Maneuver', id: burn.id, mode: 'Impulsive', attitude: 'VNB', dv: { x: Math.max(0, burn.dvKmS), y: 0, z: 0 } },
      {
        kind: 'Propagate',
        id: coastId,
        model: 'TwoBody',
        maxDuration: 20000,
        sampleStep: 60,
        stop: [{ type: 'Apoapsis' }, { type: 'Duration', value: 20000 }],
      },
    ],
  };
}

/** The nearest Maneuver segment before index i in the editable list, or null. */
function findPrecedingManeuver(segs: readonly EditableSegment[], i: number): EditableManeuver | null {
  for (let j = i - 1; j >= 0; j--) {
    const s = segs[j]!;
    if (s.kind === 'Maneuver') return s;
  }
  return null;
}
