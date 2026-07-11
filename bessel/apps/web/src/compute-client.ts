// Main-thread client for the compute worker: init with kernel bytes (and the
// Walker publication), then run grammar jobs with streamed progress and
// cooperative cancel. Mirrors CoverageClient's shape, but cancellation is a
// message that trips the job's AbortSignal in the worker (the JobHandle
// contract) rather than a terminate; dispose() still terminates.

import type { AnalysisProduct } from '@bessel/compute';
import type {
  ComputeWorkerRequest,
  ComputeWorkerResponse,
  GrammarJobSpec,
  WalkerInit,
} from './compute-protocol.ts';

export interface ComputeRun {
  readonly result: Promise<AnalysisProduct>;
  cancel(): void;
}

export interface ComputeProgressEvent {
  readonly pct: number;
  readonly partial?: AnalysisProduct;
}

export class ComputeCancelled extends Error {
  constructor() {
    super('compute job cancelled');
    this.name = 'ComputeCancelled';
  }
}

interface PendingRun {
  resolve: (p: AnalysisProduct) => void;
  reject: (err: Error) => void;
  onProgress?: (e: ComputeProgressEvent) => void;
}

export class ComputeClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRun>();
  private nextId = 1;
  readonly ready: Promise<{ kernelSetHash: string; et0: number }>;

  constructor(
    kernels: readonly { name: string; bytes: Uint8Array }[],
    epoch: string,
    walker?: Omit<WalkerInit, 'epochEt'>,
  ) {
    this.worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (ev: MessageEvent<ComputeWorkerResponse>): void => {
        if (ev.data.kind === 'ready') {
          this.worker.removeEventListener('message', onMessage);
          this.worker.addEventListener('message', this.dispatch);
          resolve({ kernelSetHash: ev.data.kernelSetHash, et0: ev.data.et0 });
        } else if (ev.data.kind === 'error' && ev.data.id === null) {
          this.worker.removeEventListener('message', onMessage);
          reject(new Error(ev.data.message));
        }
      };
      this.worker.addEventListener('message', onMessage);
    });
    this.post({
      kind: 'init',
      kernels,
      epoch,
      walker: walker ? { ...walker, epochEt: 0 } : undefined,
    });
  }

  private readonly dispatch = (ev: MessageEvent<ComputeWorkerResponse>): void => {
    const msg = ev.data;
    if (msg.kind === 'progress') {
      this.pending.get(msg.id)?.onProgress?.({ pct: msg.pct, partial: msg.partial });
    } else if (msg.kind === 'result') {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      p?.resolve(msg.product);
    } else if (msg.kind === 'error' && msg.id !== null) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      p?.reject(msg.cancelled ? new ComputeCancelled() : new Error(msg.message));
    }
  };

  run(job: GrammarJobSpec, onProgress?: (e: ComputeProgressEvent) => void): ComputeRun {
    const id = this.nextId++;
    const result = new Promise<AnalysisProduct>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
    });
    this.post({ kind: 'run', id, job });
    return {
      result,
      cancel: () => this.post({ kind: 'cancel', id }),
    };
  }

  dispose(): void {
    for (const p of this.pending.values()) p.reject(new ComputeCancelled());
    this.pending.clear();
    this.worker.terminate();
  }

  private post(msg: ComputeWorkerRequest): void {
    this.worker.postMessage(msg);
  }
}
