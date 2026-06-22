// The main-thread wrapper around the dedicated screening worker. start() validates the
// request up front (so a malformed catalog fails loudly on the calling thread, not silently
// inside the worker), constructs the worker via Vite's new Worker(new URL(...)) idiom (which
// makes Vite emit screening.worker as its own chunk, off the first-paint shell), and returns
// a promise that resolves with the flagged events on the terminal 'result' message and
// rejects on 'error'. cancel() terminates the worker (the cancellation model is termination,
// not a cooperative message) and rejects the in-flight promise.

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

  /**
   * Start a screen. Resolves with the flagged events; rejects with the worker's located
   * error, or with ScreeningCancelled if cancel() is called first. onProgress is invoked
   * for each incremental progress message. Throws synchronously on a malformed request.
   */
  start(
    request: ScreeningRequest,
    onProgress: (p: ScreeningProgress) => void,
  ): Promise<readonly ConjunctionEvent[]> {
    // Fail loud on the calling thread before spawning a worker for a request that cannot run.
    validateScreeningRequest(request);
    this.cancel();
    const worker = new Worker(new URL('./screening.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<readonly ConjunctionEvent[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ScreeningMessage>): void => {
        const msg = event.data;
        if (msg.kind === 'progress') {
          onProgress(msg);
        } else if (msg.kind === 'result') {
          this.dispose();
          resolve(msg.events);
        } else {
          this.dispose();
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (event: ErrorEvent): void => {
        this.dispose();
        reject(new Error(event.message || 'screening worker crashed'));
      };
      worker.postMessage(request);
    });
  }

  /** Cancel an in-flight screen by terminating the worker. A no-op when none is running. */
  cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
