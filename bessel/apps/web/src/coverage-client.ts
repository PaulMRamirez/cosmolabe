// The main-thread wrapper around the dedicated coverage worker. start() validates the request
// up front (so a malformed sweep fails loudly on the calling thread, not silently inside the
// worker), constructs the worker via Vite's new Worker(new URL(...)) idiom (which makes Vite
// emit coverage.worker as its OWN chunk, off the first-paint shell), and returns a promise that
// resolves with the swept cells on the terminal 'result' message and rejects on 'error'.
// cancel()/dispose() terminate the worker (the cancellation model is termination, not a
// cooperative message) AND settle the in-flight promise with CoverageCancelled, so a cancel never
// leaves the start() promise hanging. Mirrors ScreeningClient exactly so the two cancellable
// worker surfaces stay one pattern.

import { validateCoverageRequest, type CoverageMessage, type CoverageProgress, type CoverageRequest } from './coverage-protocol.ts';
import type { CoverageCell } from '@bessel/coverage';

/** The terminal cells + the regional area-weighted coverage from a finished sweep. */
export interface CoverageRunResult {
  readonly cells: readonly CoverageCell[];
  readonly areaWeightedPercentCoverage: number;
}

/** A cancellation error so the caller can distinguish a user cancel from a real failure. */
export class CoverageCancelled extends Error {
  constructor() {
    super('coverage sweep cancelled');
    this.name = 'CoverageCancelled';
  }
}

export class CoverageClient {
  private worker: Worker | null = null;
  // The in-flight start() promise's settler, held so cancel()/dispose() can reject it (rather
  // than leak a never-settled promise) and so a normal result/error can clear it.
  private pendingReject: ((reason: CoverageCancelled) => void) | null = null;

  /**
   * Start a sweep. Resolves with the swept cells + area-weighted coverage; rejects with the
   * worker's located error, or with CoverageCancelled if cancel()/dispose() is called first.
   * onProgress is invoked for each incremental progress message. Throws synchronously on a
   * malformed request.
   */
  start(request: CoverageRequest, onProgress: (p: CoverageProgress) => void): Promise<CoverageRunResult> {
    // Fail loud on the calling thread before spawning a worker for a request that cannot run.
    validateCoverageRequest(request);
    // A new run supersedes any in-flight one: terminate it and settle its promise as cancelled.
    this.teardown(true);
    const worker = new Worker(new URL('./coverage.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<CoverageRunResult>((resolve, reject) => {
      this.pendingReject = reject;
      worker.onmessage = (event: MessageEvent<CoverageMessage>): void => {
        const msg = event.data;
        if (msg.kind === 'progress') {
          onProgress(msg);
        } else if (msg.kind === 'result') {
          this.teardown(false);
          resolve({ cells: msg.cells, areaWeightedPercentCoverage: msg.areaWeightedPercentCoverage });
        } else {
          this.teardown(false);
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (event: ErrorEvent): void => {
        this.teardown(false);
        reject(new Error(event.message || 'coverage worker crashed'));
      };
      worker.postMessage(request);
    });
  }

  /** Cancel an in-flight sweep: terminate the worker and reject the start() promise as cancelled. */
  cancel(): void {
    this.teardown(true);
  }

  /** Tear down the worker and the in-flight promise. Alias of cancel(), kept for the public name. */
  dispose(): void {
    this.teardown(true);
  }

  /**
   * Terminate the worker (if any) and clear the held settler. When `rejectPending` is true the
   * in-flight start() promise is rejected with CoverageCancelled; on a normal settle it is false
   * (the caller already resolved/rejected) so the held reject is just cleared. Idempotent.
   */
  private teardown(rejectPending: boolean): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const reject = this.pendingReject;
    this.pendingReject = null;
    if (rejectPending && reject) reject(new CoverageCancelled());
  }
}
