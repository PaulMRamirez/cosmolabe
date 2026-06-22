// A DEDICATED Vite Web Worker for the all-vs-all conjunction screen, kept separate from
// the SPICE worker so that one stays focused on CSPICE geometry. The worker receives one
// ScreeningRequest, runs @bessel/conjunction's screenAllVsAll, and posts incremental
// ScreeningProgress messages plus a terminal ScreeningResult or ScreeningFailure.
//
// PROGRESS APPROACH: screenAllVsAll is a single synchronous all-vs-all call with no
// onProgress hook, so to yield progress without blocking the worker indefinitely we
// PARTITION the object set by primary index. For each primary object i we screen the
// subset [objects[i], ...objects[i+1..N]] and keep only the events whose primaryId is
// objects[i] (the pairs (i, j>i)). Unioned over every i this is exactly the upper-triangle
// of the all-vs-all matrix, so the result is identical to one screenAllVsAll over all N,
// but it is produced in N partitions and we post { done, total } after each. The library
// re-runs its own radial-shell and bounding-box sieve per partition, which is acceptable
// for the small demonstrable catalog (the cost is dominated by the per-partition sieve, not
// the work we duplicate). CANCELLATION is by the main thread terminating the worker
// (worker.terminate()); there is no cooperative cancel message, the worker simply stops.

import { screenAllVsAll, type ConjunctionEvent, type SampledEphemeris } from '@bessel/conjunction';
import {
  validateScreeningRequest,
  type ScreeningMessage,
  type ScreeningRequest,
} from './screening-protocol.ts';

const ctx = self as unknown as {
  postMessage(message: ScreeningMessage): void;
  onmessage: ((event: MessageEvent<ScreeningRequest>) => void) | null;
};

/** Screen all upper-triangle pairs in partitions, posting progress after each primary. */
function runScreen(req: ScreeningRequest): void {
  const objects = req.objects as readonly SampledEphemeris[];
  const total = objects.length - 1; // primaries 0..N-2 (the last has no higher-index pair)
  const events: ConjunctionEvent[] = [];
  for (let i = 0; i < total; i++) {
    const primary = objects[i]!;
    // Screen this primary against every higher-index object; keep only its own pairs so the
    // union over i is the upper triangle (each unordered pair counted once).
    const subset = [primary, ...objects.slice(i + 1)];
    const partial = screenAllVsAll(subset, {
      thresholdKm: req.thresholdKm,
      sieveMarginKm: req.padKm,
    });
    for (const ev of partial) {
      if (ev.primaryId === primary.id) events.push(ev);
    }
    ctx.postMessage({ kind: 'progress', done: i + 1, total });
  }
  // The per-partition results are each TCA-sorted; sort the union so the panel reads in time.
  events.sort((p, q) => p.tca - q.tca);
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
