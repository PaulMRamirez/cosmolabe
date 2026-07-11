// The editable Mission Control Sequence model the Orbit & Maneuver MCS builder drives. The
// panel edits an ordered list of EditableSegments (InitialState / Propagate / Maneuver /
// Target with its goal) through the pure mcsEditorReducer (add / remove / reorder / patch); the
// lowering to the @bessel/propagator Mcs IR lives in mcs-compile.ts. Keeping the reducer pure
// and headless makes the segment editor unit-testable without a DOM. (analysis-UX Phase 1,
// design section 3 tab 1; STK_PARITY_SPEC §4.3.)

/** The editable segment kinds the builder offers (a flat subset of the Mcs IR segments). */
export type EditableSegmentKind = 'InitialState' | 'Propagate' | 'Maneuver' | 'Target';

/** A circular-orbit InitialState seed: just the altitude (km) the panel exposes. */
export interface EditableInitialState {
  readonly kind: 'InitialState';
  readonly id: string;
  /** Circular-orbit altitude above the Earth equator (km). */
  readonly altitudeKm: number;
}

/** A coast: a two-body Propagate stopped after a fixed duration. */
export interface EditablePropagate {
  readonly kind: 'Propagate';
  readonly id: string;
  /** Coast duration (s). */
  readonly durationSec: number;
}

/** An impulsive prograde (along-track / VNB-x) burn of a given magnitude. */
export interface EditableManeuver {
  readonly kind: 'Maneuver';
  readonly id: string;
  /** Prograde delta-v magnitude (km/s). */
  readonly dvKmS: number;
}

/** A Target whose differential corrector tunes the preceding burn to a goal. The goal is a
 *  single scalar measured at the end of the sequence (radius, SMA, ...) the DC drives to. */
export interface EditableTarget {
  readonly kind: 'Target';
  readonly id: string;
  /** Which goal quantity the corrector drives the final state to. */
  readonly goalType: 'Radius' | 'SMA' | 'RadiusOfApoapsis';
  /** Desired value of the goal quantity (km). */
  readonly desiredKm: number;
  /** Convergence tolerance on the goal (km). */
  readonly toleranceKm: number;
}

export type EditableSegment =
  | EditableInitialState
  | EditablePropagate
  | EditableManeuver
  | EditableTarget;

/** The whole editable design: an ordered segment list. */
export interface EditableMcs {
  readonly segments: readonly EditableSegment[];
}

/** A monotonic id factory so two added segments of the same kind never collide. */
let segSeq = 0;
function nextId(kind: EditableSegmentKind): string {
  segSeq += 1;
  return `${kind.toLowerCase()}-${segSeq}`;
}

/** A fresh editable segment of the requested kind with sensible defaults. */
export function newSegment(kind: EditableSegmentKind): EditableSegment {
  switch (kind) {
    case 'InitialState':
      return { kind, id: nextId(kind), altitudeKm: 500 };
    case 'Propagate':
      return { kind, id: nextId(kind), durationSec: 1800 };
    case 'Maneuver':
      return { kind, id: nextId(kind), dvKmS: 0.05 };
    case 'Target':
      return { kind, id: nextId(kind), goalType: 'Radius', desiredKm: 7200, toleranceKm: 1 };
  }
}

/** The default starter sequence: a 500 km LEO seed, a coast, a prograde burn, then a Target
 *  that drives the final radius to 7200 km (the editable equivalent of the old fixed demo). */
export function defaultEditableMcs(): EditableMcs {
  return {
    segments: [
      { kind: 'InitialState', id: 'init', altitudeKm: 500 },
      { kind: 'Propagate', id: 'coast1', durationSec: 1800 },
      { kind: 'Maneuver', id: 'burn', dvKmS: 0.05 },
      { kind: 'Target', id: 'target', goalType: 'Radius', desiredKm: 7200, toleranceKm: 1 },
    ],
  };
}

/** The actions the segment editor reducer applies (all pure, returning a new EditableMcs). */
export type McsEditorAction =
  | { readonly type: 'add'; readonly kind: EditableSegmentKind }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'move'; readonly id: string; readonly dir: -1 | 1 }
  | { readonly type: 'patch'; readonly id: string; readonly patch: Partial<EditableSegment> };

/**
 * Pure reducer for the editable MCS: add a segment (appended), remove by id, reorder one slot
 * up or down (clamped at the ends), or patch a segment's params. Patch merges by id, keeping
 * the discriminant kind/id intact so a numeric field edit never changes a segment's type.
 */
export function mcsEditorReducer(state: EditableMcs, action: McsEditorAction): EditableMcs {
  switch (action.type) {
    case 'add':
      return { segments: [...state.segments, newSegment(action.kind)] };
    case 'remove':
      return { segments: state.segments.filter((s) => s.id !== action.id) };
    case 'move': {
      const i = state.segments.findIndex((s) => s.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= state.segments.length) return state;
      const next = [...state.segments];
      const [moved] = next.splice(i, 1);
      next.splice(j, 0, moved!);
      return { segments: next };
    }
    case 'patch':
      return {
        segments: state.segments.map((s) =>
          s.id === action.id ? ({ ...s, ...action.patch, kind: s.kind, id: s.id } as EditableSegment) : s,
        ),
      };
  }
}
