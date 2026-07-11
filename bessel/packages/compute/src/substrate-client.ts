// The substrate client: the host hands in a Worker it constructed (worker
// URL resolution belongs to the host's bundler) plus the init payload, and
// gets typed job runs with streamed progress and cooperative cancel back.
// Cancellation is a message that trips the job's AbortSignal in the worker
// (the JobHandle contract); dispose() rejects everything pending and
// terminates.

import type { AnalysisProduct } from './product.ts';
import type {
  JobSpec,
  SubstrateInit,
  SubstrateRequest,
  SubstrateResponse,
  WireSpkPublication,
} from './substrate-protocol.ts';

export interface JobRun {
  readonly result: Promise<AnalysisProduct>;
  cancel(): void;
}

export interface JobProgressEvent {
  readonly pct: number;
  readonly partial?: AnalysisProduct;
}

export class JobClientCancelled extends Error {
  constructor() {
    super('substrate job cancelled');
    this.name = 'JobClientCancelled';
  }
}

interface Pending {
  resolve: (p: AnalysisProduct) => void;
  reject: (err: Error) => void;
  onProgress?: (e: JobProgressEvent) => void;
}

interface PendingPublish {
  resolve: (kernelSetHash: string) => void;
  reject: (err: Error) => void;
}

/** The minimal worker surface the client drives (a DOM Worker satisfies it). */
export interface SubstrateWorker {
  postMessage(message: SubstrateRequest): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<SubstrateResponse>) => void): void;
  removeEventListener(
    type: 'message',
    listener: (ev: MessageEvent<SubstrateResponse>) => void,
  ): void;
  terminate(): void;
}

export class JobClient {
  private readonly worker: SubstrateWorker;
  private readonly pending = new Map<number, Pending>();
  private readonly pendingPublish = new Map<number, PendingPublish>();
  private nextId = 1;
  /** Resolves when the worker's ComputeEnv is furnished and ready. */
  readonly ready: Promise<{ kernelSetHash: string; et0: number | null }>;

  constructor(worker: SubstrateWorker, init: SubstrateInit) {
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (ev: MessageEvent<SubstrateResponse>): void => {
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
    this.worker.postMessage({ kind: 'init', ...init });
  }

  private readonly dispatch = (ev: MessageEvent<SubstrateResponse>): void => {
    const msg = ev.data;
    if (msg.kind === 'progress') {
      this.pending.get(msg.id)?.onProgress?.({ pct: msg.pct, partial: msg.partial });
    } else if (msg.kind === 'result') {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      p?.resolve(msg.product);
    } else if (msg.kind === 'published') {
      const p = this.pendingPublish.get(msg.id);
      this.pendingPublish.delete(msg.id);
      p?.resolve(msg.kernelSetHash);
    } else if (msg.kind === 'error' && msg.id !== null) {
      const job = this.pending.get(msg.id);
      if (job) {
        this.pending.delete(msg.id);
        job.reject(msg.cancelled ? new JobClientCancelled() : new Error(msg.message));
        return;
      }
      const pub = this.pendingPublish.get(msg.id);
      this.pendingPublish.delete(msg.id);
      pub?.reject(new Error(msg.message));
    }
  };

  /** Publish synthetic ephemerides after init (provenance-tracked); resolves
   *  with the updated kernel set hash. */
  publish(spks: readonly WireSpkPublication[]): Promise<string> {
    const id = this.nextId++;
    const result = new Promise<string>((resolve, reject) => {
      this.pendingPublish.set(id, { resolve, reject });
    });
    this.worker.postMessage({ kind: 'publish', id, spks });
    return result;
  }

  run(job: JobSpec, onProgress?: (e: JobProgressEvent) => void): JobRun {
    const id = this.nextId++;
    const result = new Promise<AnalysisProduct>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
    });
    this.worker.postMessage({ kind: 'run', id, job });
    return { result, cancel: () => this.worker.postMessage({ kind: 'cancel', id }) };
  }

  dispose(): void {
    for (const p of this.pending.values()) p.reject(new JobClientCancelled());
    for (const p of this.pendingPublish.values()) p.reject(new JobClientCancelled());
    this.pending.clear();
    this.pendingPublish.clear();
    this.worker.terminate();
  }
}
