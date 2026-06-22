// The wire protocol between the main thread and the dedicated screening worker, plus
// the deterministic synthetic catalog the demo screens, and the pure progress/result
// reducer that folds worker messages into a screening slice. Kept free of any DOM or
// Worker construction so the protocol, the builder, and the reducer can be unit-tested
// in jsdom without spawning a real worker. (The Worker itself lives in screening.worker.ts
// and the main-thread wrapper in screening-client.ts.)

import type { SampledEphemeris, ConjunctionEvent } from '@bessel/conjunction';

/** A screening request handed to the worker: the objects to screen and the thresholds. */
export interface ScreeningRequest {
  readonly objects: readonly SampledEphemeris[];
  /** Flag pairs that close below this distance (km). Must be finite and positive. */
  readonly thresholdKm: number;
  /** Sieve margin (km) added to the threshold for the coarse rejection. Must be >= 0. */
  readonly padKm: number;
}

/** Incremental progress from the worker: partitions screened so far out of the total. */
export interface ScreeningProgress {
  readonly kind: 'progress';
  readonly done: number;
  readonly total: number;
}

/** Terminal success from the worker: the flagged conjunction events. */
export interface ScreeningResult {
  readonly kind: 'result';
  readonly events: readonly ConjunctionEvent[];
}

/** Terminal failure from the worker: a located, typed error message. */
export interface ScreeningFailure {
  readonly kind: 'error';
  readonly message: string;
}

/** Every message the worker can post back to the main thread. */
export type ScreeningMessage = ScreeningProgress | ScreeningResult | ScreeningFailure;

/** A screening input/configuration error (loud, located), thrown on a malformed request. */
export class ScreeningRequestError extends Error {
  constructor(message: string) {
    super(`screening request: ${message}`);
    this.name = 'ScreeningRequestError';
  }
}

/**
 * Validate a screening request loudly. The worker runs in a separate context where an
 * unhandled throw is easy to lose, so the request shape is checked up front (here, shared
 * by the worker and the client) and a malformed request fails with a located message
 * rather than a silent empty result. Bounds are checked before screenAllVsAll so the
 * caller sees "screening request: ..." not an opaque downstream error.
 */
export function validateScreeningRequest(req: ScreeningRequest): void {
  if (!Array.isArray(req.objects)) {
    throw new ScreeningRequestError('objects must be an array');
  }
  if (req.objects.length < 2) {
    throw new ScreeningRequestError(`need at least 2 objects to screen (got ${req.objects.length})`);
  }
  if (!Number.isFinite(req.thresholdKm) || req.thresholdKm <= 0) {
    throw new ScreeningRequestError(`thresholdKm must be a positive finite number (got ${req.thresholdKm})`);
  }
  if (!Number.isFinite(req.padKm) || req.padKm < 0) {
    throw new ScreeningRequestError(`padKm must be a non-negative finite number (got ${req.padKm})`);
  }
}

/** The screening slice mirrored into the app store and rendered in the Conjunction panel. */
export interface ScreeningState {
  /** Whether a screen is running, idle, done, or has failed loudly. */
  readonly status: 'idle' | 'running' | 'done' | { readonly error: string };
  /** Partitions screened so far and the total, for the progress readout (0/0 when idle). */
  readonly done: number;
  readonly total: number;
  /** The flagged conjunction events from the last completed screen, or null. */
  readonly events: readonly ConjunctionEvent[] | null;
}

/** The screening slice before any run. */
export const INITIAL_SCREENING: ScreeningState = { status: 'idle', done: 0, total: 0, events: null };

/**
 * The local lifecycle events plus the worker messages the reducer folds into the slice:
 * 'start' opens a run, 'cancel' aborts it (the main thread terminated the worker), and the
 * worker's own progress/result/error land through ScreeningMessage.
 */
export type ScreeningEvent =
  | { readonly kind: 'start'; readonly total: number }
  | ScreeningMessage
  | { readonly kind: 'cancel' };

/**
 * Fold one screening event into the slice. Pure, so it is unit-tested directly: a 'start'
 * resets to running with a zeroed bar, a 'progress' advances done/total, a 'result' lands
 * the events and marks done, an 'error' marks failed, and a 'cancel' returns to idle.
 */
export function reduceScreening(state: ScreeningState, event: ScreeningEvent): ScreeningState {
  switch (event.kind) {
    case 'start':
      return { status: 'running', done: 0, total: Math.max(0, event.total), events: null };
    case 'progress':
      return { ...state, status: 'running', done: event.done, total: event.total };
    case 'result':
      return { ...state, status: 'done', events: event.events, done: state.total };
    case 'error':
      return { ...state, status: { error: event.message } };
    case 'cancel':
      return INITIAL_SCREENING;
    default:
      return state;
  }
}
