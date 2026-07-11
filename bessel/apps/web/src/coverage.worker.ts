// A DEDICATED Vite Web Worker for the COVERAGE GRID SWEEP, kept separate from both the SPICE
// worker (which carries CSPICE geometry) and the screening worker (which screens pre-sampled
// ephemerides). The coverage sweep needs SPICE geometry per cell per asset, so this worker
// spawns its OWN nested SPICE worker, replays the kernel-op log from the request to reproduce
// the main thread's kernel pool (base mission kernels + the published Walker asset SPKs), then
// runs @bessel/coverage's sweepCoverageGrid against that pool. The per-cell access calls thus
// run entirely off the main thread; a 24-satellite global sweep no longer stalls the UI.
//
// PROGRESS: sweepCoverageGrid exposes onProgress(fraction) after each cell; the worker forwards
// each tick as a { kind: 'progress', done, fraction } message (total is fixed and carried on the
// 'start' lifecycle event the main thread already raised). CANCELLATION is by the main thread
// terminating this worker (worker.terminate()), which the client also follows by terminating the
// nested SPICE worker reference it holds; there is no cooperative cancel message.

import { sweepCoverageGrid } from '@bessel/coverage';
import { createSpiceWorkerClient, type SpiceComputeEngine } from '@bessel/spice';
import { validateCoverageRequest, type CoverageMessage, type CoverageRequest } from './coverage-protocol.ts';
import type { KernelOp } from './spice-recorder.ts';

const ctx = self as unknown as {
  postMessage(message: CoverageMessage): void;
  onmessage: ((event: MessageEvent<CoverageRequest>) => void) | null;
};

/** Replay the recorded kernel-op log into a fresh SPICE engine so it matches the main pool. */
async function replayKernels(spice: SpiceComputeEngine, ops: readonly KernelOp[]): Promise<void> {
  for (const op of ops) {
    switch (op.kind) {
      case 'kclear':
        await spice.kclear();
        break;
      case 'furnsh':
        await spice.furnsh(op.name, op.bytes);
        break;
      case 'unload':
        await spice.unload(op.name);
        break;
      case 'writeSpkType13':
        await spice.writeSpkType13(
          op.name,
          op.body,
          op.center,
          op.frame,
          op.segid,
          op.degree,
          op.et,
          op.states,
        );
        break;
    }
  }
}

/** Replay the pool into a nested SPICE worker, sweep the grid, and post the cells. */
async function runSweep(req: CoverageRequest): Promise<void> {
  const inner = new Worker(new URL('./spice.worker.ts', import.meta.url), { type: 'module' });
  const spice = createSpiceWorkerClient(inner);
  try {
    await replayKernels(spice, req.kernels);
    const total = req.grid.latCount * req.grid.lonCount;
    const result = await sweepCoverageGrid(spice, {
      grid: req.grid,
      assets: req.assets,
      span: req.span,
      step: req.step,
      minElevationRad: req.minElevationRad,
      ...(req.abcorr ? { abcorr: req.abcorr } : {}),
      onProgress: (fraction) =>
        ctx.postMessage({ kind: 'progress', done: Math.round(fraction * total), fraction }),
    });
    ctx.postMessage({
      kind: 'result',
      cells: result.cells,
      areaWeightedPercentCoverage: result.areaWeightedPercentCoverage,
    });
  } finally {
    // Always tear the nested SPICE worker down so a finished or failed sweep leaks nothing.
    inner.terminate();
  }
}

ctx.onmessage = (event: MessageEvent<CoverageRequest>): void => {
  try {
    const req = event.data;
    validateCoverageRequest(req);
    void runSweep(req).catch((err: unknown) => {
      ctx.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    ctx.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
