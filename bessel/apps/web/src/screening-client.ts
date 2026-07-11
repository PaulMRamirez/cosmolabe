// The main-thread wrapper around the dedicated screening worker. start() validates the
// request up front (so a malformed catalog fails loudly on the calling thread, not silently
// inside the worker), constructs the worker via Vite's new Worker(new URL(...)) idiom (which
// makes Vite emit screening.worker as its own chunk, off the first-paint shell), and returns
// a promise that resolves with the flagged events on the terminal 'result' message and
// rejects on 'error'. cancel() and dispose() terminate the worker (the cancellation model is
// termination, not a cooperative message) AND settle the in-flight promise with
// ScreeningCancelled, so a cancel never leaves the start() promise hanging.

import { validateScreeningRequest, type ScreeningProgress, type ScreeningMessage, type ScreeningRequest } from './screening-protocol.ts';
import type { ConjunctionEvent } from '@bessel/conjunction';

/** A cancellation error so the caller can distinguish a user cancel from a real failure. */
export class ScreeningCancelled extends Error {
  constructor() {
    super('screening cancelled');
    this.name = 'ScreeningCancelled';
  }
}

export class ScreeningClient {
  private worker: Worker | null = null;
  // The in-flight start() promise's settlers, held so cancel()/dispose() can reject it (rather
  // than leak a never-settled promise) and so a normal result/error can clear them.
  private pendingReject: ((reason: ScreeningCancelled) => void) | null = null;

  /**
   * Start a screen. Resolves with the flagged events; rejects with the worker's located
   * error, or with ScreeningCancelled if cancel()/dispose() is called first. onProgress is
   * invoked for each incremental progress message. Throws synchronously on a malformed request.
   */
  start(
    request: ScreeningRequest,
    onProgress: (p: ScreeningProgress) => void,
  ): Promise<readonly ConjunctionEvent[]> {
    // Fail loud on the calling thread before spawning a worker for a request that cannot run.
    validateScreeningRequest(request);
    // A new run supersedes any in-flight one: terminate it and settle its promise as cancelled.
    this.teardown(true);
    const worker = new Worker(new URL('./screening.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<readonly ConjunctionEvent[]>((resolve, reject) => {
      this.pendingReject = reject;
      worker.onmessage = (event: MessageEvent<ScreeningMessage>): void => {
        const msg = event.data;
        if (msg.kind === 'progress') {
          onProgress(msg);
        } else if (msg.kind === 'result') {
          this.teardown(false);
          resolve(msg.events);
        } else {
          this.teardown(false);
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (event: ErrorEvent): void => {
        this.teardown(false);
        reject(new Error(event.message || 'screening worker crashed'));
      };
      worker.postMessage(request);
    });
  }

  /** Cancel an in-flight screen: terminate the worker and reject the start() promise as cancelled. */
  cancel(): void {
    this.teardown(true);
  }

  /** Tear down the worker and the in-flight promise. Alias of cancel(), kept for the public name. */
  dispose(): void {
    this.teardown(true);
  }

  /**
   * Terminate the worker (if any) and clear the held settlers. When `rejectPending` is true the
   * in-flight start() promise is rejected with ScreeningCancelled; on a normal settle it is false
   * (the caller already resolved/rejected) so the held reject is just cleared. Idempotent.
   */
  private teardown(rejectPending: boolean): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const reject = this.pendingReject;
    this.pendingReject = null;
    if (rejectPending && reject) reject(new ScreeningCancelled());
  }
}
