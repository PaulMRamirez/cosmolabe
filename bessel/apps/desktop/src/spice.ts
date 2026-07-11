import { createSpiceWorkerClient, type SpiceEngine } from '@bessel/spice';

export function connectSpice(): SpiceEngine {
  const worker = new Worker(new URL('./spice.worker.ts', import.meta.url), { type: 'module' });
  return createSpiceWorkerClient(worker);
}
