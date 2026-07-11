// The state carried through a Mission Control Sequence. MissionState is IMMUTABLE: every
// segment returns a fresh state rather than mutating, so the differential corrector can
// re-run a child branch from the same input without side effects. Bridges to/from the
// SPICE CartesianState and the integrator's flat 6-vector (y6). (STK_PARITY_SPEC §4.3.)

import type { CartesianState, Vec3 } from '@bessel/spice';
import type { DcReport } from './corrector/solve.ts';
import type { OptimizerReport } from './corrector/optimize.ts';

export type TdbSeconds = number;
export type SegmentId = string;

/** The propagated state at a segment boundary (central-body-centered, J2000). */
export interface MissionState {
  readonly epoch: TdbSeconds;
  readonly r: Vec3; // km
  readonly v: Vec3; // km/s
  readonly mass: number; // kg (carried, geometry-inert in the MVP)
  readonly centralBody: number; // NAIF id
  readonly segmentPath: readonly string[];
}

/** One sampled state along an arc, ready to flow into publishEphemeris. */
export interface StateSample {
  readonly et: TdbSeconds;
  readonly state: CartesianState;
}

/** How a segment ended: ran to completion, a stop condition fired, or it hit the backstop. */
export type SegmentStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'stopped'; readonly by: string } // the stop-condition name that fired
  | { readonly kind: 'backstop' }; // maxDuration reached, no geometric stop triggered

/** The result of executing one segment: the output state, its samples, status, and halt flag. */
export interface SegmentResult {
  readonly out: MissionState;
  readonly samples: readonly StateSample[];
  readonly status: SegmentStatus;
  /** A downstream Stop short-circuits the enclosing Sequence fold. */
  readonly halt: boolean;
  /** When STM co-integration was requested: Phi(et, stmEpoch) row-major (length 36). */
  readonly stmAt?: (et: number) => Float64Array;
  /** The arc-start epoch the STM is referenced to (the segment's input epoch). */
  readonly stmEpoch?: number;
  /** Differential-corrector reports produced within this segment (Target subtrees). */
  readonly targetReports?: readonly DcReport[];
  /** Optimizer reports produced within this segment (OPTIMIZER-mode Target subtrees). */
  readonly optimizerReports?: readonly OptimizerReport[];
}

/** View a MissionState as a SPICE CartesianState (for propagateCowellEx). */
export function toCartesian(s: MissionState): CartesianState {
  return { position: s.r, velocity: s.v };
}

/** A fresh MissionState at epoch `et` from a flat 6-vector y6 = [r, v], keeping mass/body/path. */
export function withY6(s: MissionState, et: number, y6: Float64Array): MissionState {
  return {
    epoch: et,
    r: { x: y6[0]!, y: y6[1]!, z: y6[2]! },
    v: { x: y6[3]!, y: y6[4]!, z: y6[5]! },
    mass: s.mass,
    centralBody: s.centralBody,
    segmentPath: s.segmentPath,
  };
}

/** A copy of `s` with `label` appended to its segment path. */
export function pushPath(s: MissionState, label: string): MissionState {
  return { ...s, segmentPath: [...s.segmentPath, label] };
}

/** The StateSample at the state's own epoch. */
export function sampleOf(s: MissionState): StateSample {
  return { et: s.epoch, state: { position: s.r, velocity: s.v } };
}
