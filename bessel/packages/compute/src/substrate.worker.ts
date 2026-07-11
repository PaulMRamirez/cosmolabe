// The worker substrate entry: one ComputeEnv per worker, jobs by spec,
// streamed progress, cooperative cancel. Hosts bundle this module as their
// worker file (a side-effect import) and speak the substrate protocol; the
// wasm URL arrives in init because asset resolution belongs to the host's
// bundler. Every kernel and synthetic publication flows through the frames
// tier, so provenance covers exactly this worker's pool.

import {
  accessJob,
  coverageJob,
  createComputeEnv,
  groundTrackJob,
  porkchopJob,
  seriesJob,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
  type EngineJob,
  type JobHandle,
} from './index.ts';
import type { JobSpec, SubstrateRequest, SubstrateResponse } from './substrate-protocol.ts';

let env: ComputeEnv | null = null;
const handles = new Map<number, JobHandle>();

const post = (msg: SubstrateResponse): void => {
  (self as unknown as { postMessage(m: SubstrateResponse): void }).postMessage(msg);
};

function buildJob(spec: JobSpec): EngineJob {
  switch (spec.kind) {
    case 'access':
      return accessJob(spec.request);
    case 'coverage':
      return coverageJob(spec.request);
    case 'series':
      return seriesJob(spec.request);
    case 'porkchop':
      return porkchopJob(spec.request);
    case 'groundTrack':
      return groundTrackJob(spec.request);
  }
}

async function runJob(id: number, spec: JobSpec): Promise<void> {
  if (!env) {
    post({ kind: 'error', id, message: 'substrate worker not initialized', cancelled: false });
    return;
  }
  const handle = submitJob(env, buildJob(spec));
  handles.set(id, handle);
  try {
    for await (const e of handle.progress) {
      post({ kind: 'progress', id, pct: e.pct, partial: e.partial });
    }
    post({ kind: 'result', id, product: await handle.result });
  } catch (err) {
    post({
      kind: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      cancelled: err instanceof JobCancelledError,
    });
  } finally {
    handles.delete(id);
  }
}

(self as unknown as { onmessage: (ev: MessageEvent<SubstrateRequest>) => void }).onmessage =
  async (ev: MessageEvent<SubstrateRequest>) => {
    const msg = ev.data;
    switch (msg.kind) {
      case 'init': {
        try {
          env = await createComputeEnv(
            msg.wasmUrl ? { locateFile: () => msg.wasmUrl! } : undefined,
          );
          for (const k of msg.kernels) env.furnish(k.name, k.bytes);
          for (const spk of msg.publish ?? []) env.publishSpk(spk);
          post({
            kind: 'ready',
            kernelSetHash: env.frames.kernels().setHash,
            et0: msg.epoch === undefined ? null : env.frames.toEt(msg.epoch),
          });
        } catch (err) {
          post({
            kind: 'error',
            id: null,
            message: err instanceof Error ? err.message : String(err),
            cancelled: false,
          });
        }
        break;
      }
      case 'publish': {
        if (!env) {
          post({ kind: 'error', id: msg.id, message: 'substrate worker not initialized', cancelled: false });
          break;
        }
        try {
          for (const spk of msg.spks) env.publishSpk(spk);
          post({ kind: 'published', id: msg.id, kernelSetHash: env.frames.kernels().setHash });
        } catch (err) {
          post({
            kind: 'error',
            id: msg.id,
            message: err instanceof Error ? err.message : String(err),
            cancelled: false,
          });
        }
        break;
      }
      case 'run':
        void runJob(msg.id, msg.job);
        break;
      case 'cancel':
        handles.get(msg.id)?.cancel();
        break;
    }
  };
