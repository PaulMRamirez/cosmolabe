// [ux-p3-conjunction] The main-thread wrapper around the dedicated porkchop worker. start() validates
// the request up front (so a malformed grid fails loudly on the calling thread, not silently inside
// the worker), constructs the worker via Vite's new Worker(new URL(...)) idiom (which makes Vite emit
// porkchop.worker as its own chunk, off the first-paint shell), and returns a promise that resolves
// with the solved PorkchopResult on the terminal 'result' message and rejects on 'error'. cancel()
// and dispose() terminate the worker (the cancellation model is termination, not a cooperative
// message) AND settle the in-flight promise with PorkchopCancelled, so a cancel never leaves the
// start() promise hanging. This mirrors screening-client.ts.

import {
  validatePorkchopRequest,
  type PorkchopMessage,
  type PorkchopProgress,
  type PorkchopRequest,
} from './porkchop-protocol.ts';
import type { PorkchopResult } from '@bessel/mission';

/** A cancellation error so the caller can distinguish a user cancel from a real failure. */
export class PorkchopCancelled extends Error {
  constructor() {
    super('porkchop cancelled');
    this.name = 'PorkchopCancelled';
  }
}

export class PorkchopClient {
  private worker: Worker | null = null;
  // The in-flight start() promise's reject settler, held so cancel()/dispose() can reject it (rather
  // than leak a never-settled promise) and so a normal result/error can clear it.
  private pendingReject: ((reason: PorkchopCancelled) => void) | null = null;

  /**
   * Start a sweep. Resolves with the solved PorkchopResult; rejects with the worker's located error,
   * or with PorkchopCancelled if cancel()/dispose() is called first. onProgress is invoked for each
   * incremental progress message. Throws synchronously on a malformed request.
   */
  start(
    request: PorkchopRequest,
    onProgress: (p: PorkchopProgress) => void,
  ): Promise<PorkchopResult> {
    // Fail loud on the calling thread before spawning a worker for a request that cannot run.
    validatePorkchopRequest(request);
    // A new run supersedes any in-flight one: terminate it and settle its promise as cancelled.
    this.teardown(true);
    const worker = new Worker(new URL('./porkchop.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<PorkchopResult>((resolve, reject) => {
      this.pendingReject = reject;
      worker.onmessage = (event: MessageEvent<PorkchopMessage>): void => {
        const msg = event.data;
        if (msg.kind === 'progress') {
          onProgress(msg);
        } else if (msg.kind === 'result') {
          this.teardown(false);
          resolve(msg.result);
        } else {
          this.teardown(false);
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (event: ErrorEvent): void => {
        this.teardown(false);
        reject(new Error(event.message || 'porkchop worker crashed'));
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
   * in-flight start() promise is rejected with PorkchopCancelled; on a normal settle it is false
   * (the caller already resolved/rejected) so the held reject is just cleared. Idempotent.
   */
  private teardown(rejectPending: boolean): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const reject = this.pendingReject;
    this.pendingReject = null;
    if (rejectPending && reject) reject(new PorkchopCancelled());
  }
}
