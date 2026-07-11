// The job protocol of ADR M-0004: every engine runs behind one typed
// JobHandle (streaming progress with partials, a result promise, cancel),
// identical across panel, app, SDK, and CLI. JobHandle is transcribed exactly
// as typed in docs/design/02 section 5. The runner, submitJob, is the only
// producer of Provenance in this tree and always stamps authority
// 'exploratory' (iron rule 4); a job that so much as carries an authority
// property is refused loudly, so an engine cannot smuggle 'host'. Kernel
// provenance is read from the frames tier at job start, which is why a
// ComputeEnv binds one engine and one frames layer over one shared bindings
// instance: the set hash describes exactly the pool the engine computes with.

import {
  createSpiceBindings,
  spiceEngineOver,
  JobCancelledError,
  type SpiceEngine,
  type SpiceEngineOptions,
} from 'cspice-wasm';
import { framesLayerOver, type FramesLayer } from '@cosmolabe/frames';
import type { AnalysisProduct, Product, Provenance, UnitMap } from './product.ts';
import { AsyncQueue } from './queue.ts';

export { JobCancelledError };

/** One streamed progress event: percent complete plus an optional partial. */
export interface JobProgress {
  readonly pct: number;
  readonly partial?: AnalysisProduct;
}

export interface JobHandle {
  progress: AsyncIterable<JobProgress>;
  result: Promise<AnalysisProduct>;
  cancel(): void;
}

/** What a running job may touch: the shared engine, frames, and its signal. */
export interface JobRunContext {
  readonly engine: SpiceEngine;
  readonly frames: FramesLayer;
  /** Aborts when cancel() is called; adapters check it at their loop points. */
  readonly signal: AbortSignal;
  /** Throw JobCancelledError if the job has been cancelled. */
  throwIfCancelled(): void;
}

/**
 * An engine wired as a job: identity and semantics for the provenance stamp,
 * a UnitMap declared up front (partials and the final product carry the same
 * units), and a generator that yields progress (with raw Product partials)
 * and returns the final Product. The runner wraps every partial and the
 * result in AnalysisProduct with one provenance block; adapters never see or
 * set authority.
 */
export interface EngineJob {
  readonly engine: string;
  readonly version: string;
  readonly frame: Provenance['frame'];
  readonly correction: Provenance['correction'];
  readonly units: UnitMap;
  run(ctx: JobRunContext): AsyncGenerator<{ pct: number; partial?: Product }, Product>;
}

/**
 * One SPICE state for engines and provenance: the promise-surface engine and
 * the frames layer share a single bindings instance, and kernels flow in
 * through the frames layer so the set hash tracks them.
 */
/** A synthetic Type 13 ephemeris to publish into the environment. */
export interface SpkPublication {
  readonly name: string;
  readonly body: number;
  readonly center: number;
  readonly frame: string;
  readonly segid: string;
  readonly degree: number;
  readonly epochs: Float64Array;
  readonly states: Float64Array;
}

export interface ComputeEnv {
  readonly engine: SpiceEngine;
  readonly frames: FramesLayer;
  /** Furnish a kernel through the frames tier (tracked in the set hash). */
  furnish(name: string, bytes: Uint8Array): void;
  /**
   * Publish a synthetic Type 13 SPK (a designed constellation, a propagated
   * arc) through the frames tier: the written kernel's bytes are read back
   * and furnished on the tracked path, so a product computed against a
   * synthetic ephemeris carries it in the provenance kernel set like any
   * fetched kernel. Provenance that omitted synthetic inputs would lie.
   */
  publishSpk(spk: SpkPublication): void;
}

export async function createComputeEnv(options?: SpiceEngineOptions): Promise<ComputeEnv> {
  const bindings = await createSpiceBindings(options);
  const frames = framesLayerOver(bindings);
  const engine = spiceEngineOver(bindings);
  return {
    engine,
    frames,
    furnish(name, bytes) {
      frames.furnish(name, bytes);
    },
    publishSpk(spk) {
      bindings.writeSpkType13(
        spk.name, spk.body, spk.center, spk.frame, spk.segid, spk.degree, spk.epochs, spk.states,
      );
      const bytes = bindings.readKernelBytes(spk.name);
      bindings.unload(spk.name);
      frames.furnish(spk.name, bytes);
    },
  };
}

let jobSeq = 0;

/**
 * Submit an engine job on a compute environment. The job starts immediately;
 * progress events buffer until iterated (single consumer). cancel() aborts
 * cooperatively: the result promise rejects with JobCancelledError and the
 * progress stream ends. Every emitted AnalysisProduct, partial or final,
 * carries the same provenance block, stamped once at submit time with
 * authority 'exploratory' and the frames tier's current kernel set.
 */
export function submitJob(env: ComputeEnv, job: EngineJob): JobHandle {
  if ('authority' in job) {
    throw new Error(
      `submitJob: job '${job.engine}' carries an authority property; authority is stamped ` +
        `by the runner ('exploratory' for every engine) and 'host' is settable only by host ` +
        `data adapters (ADR M-0004, iron rule 4)`,
    );
  }

  const kernelSet = env.frames.kernels();
  const provenance: Provenance = {
    engine: job.engine,
    version: job.version,
    kernels: { setHash: kernelSet.setHash, names: kernelSet.kernels.map((k) => k.name) },
    frame: job.frame,
    correction: job.correction,
    authority: 'exploratory',
    computedAt: new Date().toISOString(),
    jobId: `${job.engine}-${++jobSeq}`,
  };

  const controller = new AbortController();
  const queue = new AsyncQueue<JobProgress>();
  const wrap = (product: Product): AnalysisProduct => ({
    product,
    provenance,
    units: job.units,
  });

  const ctx: JobRunContext = {
    engine: env.engine,
    frames: env.frames,
    signal: controller.signal,
    throwIfCancelled() {
      if (controller.signal.aborted) throw new JobCancelledError();
    },
  };

  const result = (async (): Promise<AnalysisProduct> => {
    try {
      const gen = job.run(ctx);
      for (;;) {
        ctx.throwIfCancelled();
        const step = await gen.next();
        // A yield that completed after cancel() is dropped, not delivered:
        // cancel means no further events reach the consumer.
        ctx.throwIfCancelled();
        if (step.done) {
          const final = wrap(step.value);
          queue.push({ pct: 100, partial: final });
          return final;
        }
        queue.push({
          pct: step.value.pct,
          partial: step.value.partial ? wrap(step.value.partial) : undefined,
        });
        // Yield a macrotask per progress step so a worker-hosted job delivers
        // queued messages (cancel included) at every stream boundary; the
        // engines' own awaits are microtasks and would otherwise starve the
        // event loop for the whole job.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      queue.close();
    }
  })();
  // The handle owner may consume only progress; keep an intentional listener
  // on the result so a cancellation is not an unhandled rejection.
  void result.catch(() => {});

  return {
    progress: queue,
    result,
    cancel() {
      controller.abort();
    },
  };
}
