// The wire protocol between the main thread and the dedicated coverage worker, plus the
// pure progress reducer that folds worker messages into the coverage-sweep progress slice.
// Kept free of any DOM or Worker construction so the protocol, the validator, and the reducer
// can be unit-tested in jsdom without spawning a real worker. (The Worker itself lives in
// coverage.worker.ts and the main-thread wrapper in coverage-client.ts.)
//
// Unlike the screening worker (which screens pre-sampled ephemeris arrays), the coverage sweep
// needs SPICE geometry, so the request carries the replayable kernel-op log: the worker spawns
// its OWN SPICE worker and replays the log to reproduce the kernel pool (base mission kernels +
// the published Walker asset SPKs) before running sweepCoverageGrid against it. This is what
// moves a 24-satellite global sweep, with its per-cell per-asset access calls, entirely off the
// main thread so the UI does not stall.

import type { GridSpec, CoverageCell } from '@bessel/coverage';
import type { AberrationCorrection } from '@bessel/spice';
import type { KernelOp } from './spice-recorder.ts';

/** A coverage-sweep request handed to the worker: the kernel pool to replay plus the sweep. */
export interface CoverageRequest {
  /** The replayable kernel-op log (base kernels + published asset SPKs), applied in order. */
  readonly kernels: readonly KernelOp[];
  readonly grid: GridSpec;
  /** Asset SPK ids/names; a cell sees coverage when any asset is in view (1-fold). */
  readonly assets: readonly string[];
  /** Search span [start, stop] in ET seconds. */
  readonly span: readonly [number, number];
  /** Geometry-finder step (s); must be shorter than the briefest pass. */
  readonly step: number;
  /** Minimum elevation above the local horizon (rad) for a pass to count. */
  readonly minElevationRad: number;
  readonly abcorr?: AberrationCorrection;
}

/**
 * Incremental progress from the worker: the swept fraction in [0, 1] and the cells done/total,
 * for a live readout. The total is fixed for the run (latCount * lonCount), carried on the
 * 'start' lifecycle event the main thread raises, so the per-tick message only needs the
 * advancing `done` count plus the convenience `fraction`.
 */
export interface CoverageProgress {
  readonly kind: 'progress';
  readonly done: number;
  readonly fraction: number;
}

/** Terminal success from the worker: the swept cells and the area-weighted percent coverage. */
export interface CoverageResult {
  readonly kind: 'result';
  readonly cells: readonly CoverageCell[];
  readonly areaWeightedPercentCoverage: number;
}

/** Terminal failure from the worker: a located, typed error message. */
export interface CoverageFailure {
  readonly kind: 'error';
  readonly message: string;
}

/** Every message the coverage worker can post back to the main thread. */
export type CoverageMessage = CoverageProgress | CoverageResult | CoverageFailure;

/** A coverage request/configuration error (loud, located), thrown on a malformed request. */
export class CoverageRequestError extends Error {
  constructor(message: string) {
    super(`coverage request: ${message}`);
    this.name = 'CoverageRequestError';
  }
}

/**
 * Validate a coverage request loudly. The worker runs in a separate context where an unhandled
 * throw is easy to lose, so the request shape is checked up front (here, shared by the worker
 * and the client) and a malformed request fails with a located message rather than a silent
 * empty overlay. Bounds are checked before the sweep so the caller sees "coverage request: ..."
 * not an opaque downstream error.
 */
export function validateCoverageRequest(req: CoverageRequest): void {
  if (!Array.isArray(req.kernels) || req.kernels.length === 0) {
    throw new CoverageRequestError('kernels must be a non-empty replay log');
  }
  if (!Array.isArray(req.assets) || req.assets.length === 0) {
    throw new CoverageRequestError('a sweep needs at least one asset');
  }
  const g = req.grid;
  if (!g || g.latCount < 1 || g.lonCount < 1) {
    throw new CoverageRequestError(`latCount and lonCount must be >= 1 (got ${g?.latCount}, ${g?.lonCount})`);
  }
  const [t0, t1] = req.span;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    throw new CoverageRequestError(`span must be increasing and finite, got [${t0}, ${t1}]`);
  }
  if (!Number.isFinite(req.step) || req.step <= 0) {
    throw new CoverageRequestError(`step must be a positive finite number (got ${req.step})`);
  }
  if (!Number.isFinite(req.minElevationRad)) {
    throw new CoverageRequestError(`minElevationRad must be finite (got ${req.minElevationRad})`);
  }
}

/** The coverage-sweep progress slice mirrored into the app store and rendered in the panel. */
export interface CoverageSweepState {
  /** Whether a sweep is running, idle, done, or has failed loudly. */
  readonly status: 'idle' | 'running' | 'done' | { readonly error: string };
  /** Cells swept so far and the total, for the progress readout (0/0 when idle). */
  readonly done: number;
  readonly total: number;
}

/** The coverage-sweep progress slice before any run. */
export const INITIAL_COVERAGE_SWEEP: CoverageSweepState = { status: 'idle', done: 0, total: 0 };

/**
 * The local lifecycle events plus the worker messages the reducer folds into the slice:
 * 'start' opens a run (carrying the total cell count), 'cancel' aborts it (the main thread
 * terminated the worker), and the worker's own progress/result/error land through CoverageMessage.
 */
export type CoverageSweepEvent =
  | { readonly kind: 'start'; readonly total: number }
  | CoverageMessage
  | { readonly kind: 'cancel' };

/**
 * Fold one coverage-sweep event into the slice. Pure, so it is unit-tested directly: a 'start'
 * resets to running with a zeroed bar, a 'progress' advances done, a 'result' marks done and fills
 * the bar, an 'error' marks failed, and a 'cancel' returns to idle.
 */
export function reduceCoverageSweep(state: CoverageSweepState, event: CoverageSweepEvent): CoverageSweepState {
  switch (event.kind) {
    case 'start':
      return { status: 'running', done: 0, total: Math.max(0, event.total) };
    case 'progress':
      // The total is fixed for the run (set on 'start'); a progress tick only advances `done`.
      return { ...state, status: 'running', done: event.done };
    case 'result':
      return { ...state, status: 'done', done: state.total };
    case 'error':
      return { ...state, status: { error: event.message } };
    case 'cancel':
      return INITIAL_COVERAGE_SWEEP;
    default:
      return state;
  }
}
