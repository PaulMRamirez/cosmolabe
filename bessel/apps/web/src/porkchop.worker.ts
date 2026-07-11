// [ux-p3-conjunction] A DEDICATED Vite Web Worker for the Lambert porkchop grid sweep, kept off the
// main thread so a larger departure x time-of-flight grid does not stall the UI. The worker receives
// one PorkchopRequest (the grid axes, the central-body GM, and the PRE-SAMPLED departure/arrival
// body states, so the worker is SPICE-free), runs the pure sweepPorkchop, and posts incremental
// PorkchopProgress messages (one per departure column) plus a terminal PorkchopResultMessage or
// PorkchopFailure. CANCELLATION is by the main thread terminating the worker (worker.terminate());
// there is no cooperative cancel message, the worker simply stops. This mirrors screening.worker.ts.

import { sweepPorkchop } from './engine/porkchop.ts';
import { validatePorkchopRequest, type PorkchopMessage, type PorkchopRequest } from './porkchop-protocol.ts';

const ctx = self as unknown as {
  postMessage(message: PorkchopMessage): void;
  onmessage: ((event: MessageEvent<PorkchopRequest>) => void) | null;
};

/** Run the pure grid sweep, forwarding sweepPorkchop's per-column progress to the main thread. */
function runSweep(req: PorkchopRequest): void {
  const result = sweepPorkchop(req.grid, req.mu, req.departureStates, req.arrivalStates, req.label, {
    onProgress: (done, total) => ctx.postMessage({ kind: 'progress', done, total }),
  });
  ctx.postMessage({ kind: 'result', result });
}

ctx.onmessage = (event: MessageEvent<PorkchopRequest>): void => {
  try {
    const req = event.data;
    validatePorkchopRequest(req);
    runSweep(req);
  } catch (err) {
    ctx.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
