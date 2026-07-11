// A DEDICATED Vite Web Worker for the all-vs-all conjunction screen, kept separate from
// the SPICE worker so that one stays focused on CSPICE geometry. The worker receives one
// ScreeningRequest, runs @bessel/conjunction's screenAllVsAll, and posts incremental
// ScreeningProgress messages plus a terminal ScreeningResult or ScreeningFailure.
//
// PROGRESS APPROACH: screenAllVsAll runs ONCE over all objects and yields progress through its
// onProgress hook, which fires after each primary object i finishes (done = i + 1, total =
// objects.length - 1). The worker forwards each tick as a { kind: 'progress', done } message (the
// total is fixed and is carried on the 'start' event the main thread already sent). This replaces
// the earlier per-primary re-partitioning (which re-ran the library's sieve for every primary, an
// O(N^3) re-sieve); the single call produces the identical upper-triangle result with no
// duplicated work. CANCELLATION is by the main thread terminating the worker (worker.terminate());
// there is no cooperative cancel message, the worker simply stops.

import { screenAllVsAll, type SampledEphemeris } from '@bessel/conjunction';
import {
  validateScreeningRequest,
  type ScreeningMessage,
  type ScreeningRequest,
} from './screening-protocol.ts';

const ctx = self as unknown as {
  postMessage(message: ScreeningMessage): void;
  onmessage: ((event: MessageEvent<ScreeningRequest>) => void) | null;
};

/** Screen all upper-triangle pairs in one call, forwarding the library's per-primary progress. */
function runScreen(req: ScreeningRequest): void {
  const objects = req.objects as readonly SampledEphemeris[];
  const events = screenAllVsAll(objects, {
    thresholdKm: req.thresholdKm,
    sieveMarginKm: req.padKm,
    onProgress: (done) => ctx.postMessage({ kind: 'progress', done }),
  });
  ctx.postMessage({ kind: 'result', events });
}

ctx.onmessage = (event: MessageEvent<ScreeningRequest>): void => {
  try {
    const req = event.data;
    validateScreeningRequest(req);
    runScreen(req);
  } catch (err) {
    ctx.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
