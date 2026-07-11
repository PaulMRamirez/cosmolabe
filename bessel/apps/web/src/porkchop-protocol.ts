// [ux-p3-conjunction] The wire protocol between the main thread and the dedicated porkchop worker,
// plus the pure progress/result reducer that folds worker messages into a porkchop-run slice. Kept
// free of any DOM or Worker construction so the protocol + reducer can be unit-tested in jsdom
// without spawning a real worker. (The Worker itself lives in porkchop.worker.ts and the main-thread
// wrapper in porkchop-client.ts; this mirrors the screening worker/client/protocol pattern.)
//
// The SPICE body-state sampling (spkezr) stays on the main thread (the SPICE worker is the only
// thing that touches CSPICE), so the request ships the PRE-SAMPLED departure/arrival states and the
// central-body GM; the worker only runs the pure, CPU-bound sweepPorkchop grid solve and yields a
// per-departure-column progress tick. Cancellation is by the main thread terminating the worker.

import type { PorkchopResult, PorkchopGrid, SampledState } from './engine/porkchop.ts';

/** A porkchop sweep request handed to the worker: the grid axes, the central-body GM, the
 *  pre-sampled departure/arrival body states (SPICE-free in the worker), and the contour label. */
export interface PorkchopRequest {
  readonly grid: PorkchopGrid;
  /** Central-body GM (km^3/s^2); must be finite and positive. */
  readonly mu: number;
  /** Departure body states aligned to grid.departureEt (one per departure epoch). */
  readonly departureStates: readonly SampledState[];
  /** Arrival body states as a departure-major, TOF-minor matrix (one row per departure epoch). */
  readonly arrivalStates: readonly (readonly SampledState[])[];
  readonly label: string;
}

/** Incremental progress from the worker: departure columns solved so far, and the fixed total. */
export interface PorkchopProgress {
  readonly kind: 'progress';
  readonly done: number;
  readonly total: number;
}

/** Terminal success from the worker: the solved porkchop result (grid + best). */
export interface PorkchopResultMessage {
  readonly kind: 'result';
  readonly result: PorkchopResult;
}

/** Terminal failure from the worker: a located, typed error message. */
export interface PorkchopFailure {
  readonly kind: 'error';
  readonly message: string;
}

/** Every message the porkchop worker can post back to the main thread. */
export type PorkchopMessage = PorkchopProgress | PorkchopResultMessage | PorkchopFailure;

/** A porkchop request/configuration error (loud, located), thrown on a malformed request. */
export class PorkchopRequestError extends Error {
  constructor(message: string) {
    super(`porkchop request: ${message}`);
    this.name = 'PorkchopRequestError';
  }
}

/**
 * Validate a porkchop request loudly, shared by the worker and the client. The worker runs in a
 * separate context where an unhandled throw is easy to lose, so the request shape (grid axes >= 2,
 * a positive GM, and state matrices that match the axes) is checked up front and a malformed request
 * fails with a located "porkchop request: ..." message rather than a silent empty grid.
 */
export function validatePorkchopRequest(req: PorkchopRequest): void {
  const nd = req.grid.departureEt.length;
  const nt = req.grid.tofSec.length;
  if (nd < 2 || nt < 2) {
    throw new PorkchopRequestError(`grid needs >= 2x2 nodes, got ${nd}x${nt}`);
  }
  if (!Number.isFinite(req.mu) || req.mu <= 0) {
    throw new PorkchopRequestError(`mu must be a positive finite number (got ${req.mu})`);
  }
  if (req.departureStates.length !== nd) {
    throw new PorkchopRequestError(`departureStates length ${req.departureStates.length} != ${nd}`);
  }
  if (req.arrivalStates.length !== nd) {
    throw new PorkchopRequestError(`arrivalStates rows ${req.arrivalStates.length} != ${nd}`);
  }
}

/** The porkchop-run slice mirrored into the app store and rendered in the Lambert card. */
export interface PorkchopRunState {
  /** Whether a sweep is running, idle, done, or failed loudly. */
  readonly status: 'idle' | 'running' | 'done' | { readonly error: string };
  /** Departure columns solved so far and the total, for the progress readout (0/0 when idle). */
  readonly done: number;
  readonly total: number;
}

/** The porkchop-run slice before any sweep. */
export const INITIAL_PORKCHOP_RUN: PorkchopRunState = { status: 'idle', done: 0, total: 0 };

/**
 * The local lifecycle events plus the worker messages the reducer folds into the run slice:
 * 'start' opens a run (carrying the total departure columns), 'cancel' aborts it (the main thread
 * terminated the worker), and the worker's own progress/result/error land through PorkchopMessage.
 */
export type PorkchopRunEvent =
  | { readonly kind: 'start'; readonly total: number }
  | PorkchopMessage
  | { readonly kind: 'cancel' };

/**
 * Fold one porkchop-run event into the slice. Pure, so it is unit-tested directly: a 'start' resets
 * to running with a zeroed bar, a 'progress' advances done/total, a 'result' marks done, an 'error'
 * marks failed, and a 'cancel' returns to idle.
 */
export function reducePorkchopRun(state: PorkchopRunState, event: PorkchopRunEvent): PorkchopRunState {
  switch (event.kind) {
    case 'start':
      return { status: 'running', done: 0, total: Math.max(0, event.total) };
    case 'progress':
      return { status: 'running', done: event.done, total: event.total };
    case 'result':
      return { ...state, status: 'done', done: state.total };
    case 'error':
      return { ...state, status: { error: event.message } };
    case 'cancel':
      return INITIAL_PORKCHOP_RUN;
    default:
      return state;
  }
}
