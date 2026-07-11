// Constructs the SPICE worker and a main-thread client. The worker carries
// CSPICE-WASM, so geometry and kernel loading stay off the main thread. The client
// is a SpiceComputeEngine, so it also runs F3 batched/cancellable evalSeries jobs in
// one round-trip. Heavy multi-core sweeps use createSpiceWorkerPool over several
// workers; normal rendering keeps the single client to avoid N-fold kernel loading.
// The client is wrapped with a kernel-op recorder (spice-recorder.ts) so the dedicated
// coverage worker can replay the kernel pool into its own nested SPICE worker.
import { createSpiceWorkerClient } from '@bessel/spice';
import { recordKernelOps, type RecordingSpiceEngine } from './spice-recorder.ts';

export function connectSpice(): RecordingSpiceEngine {
  const worker = new Worker(new URL('./spice.worker.ts', import.meta.url), { type: 'module' });
  return recordKernelOps(createSpiceWorkerClient(worker));
}
