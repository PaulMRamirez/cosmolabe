// The compute worker: hosts a @bessel/compute ComputeEnv (its own in-process
// CSPICE-WASM instance, kept off the main thread like every SPICE stack in
// this app) and runs the grammar demo jobs with streamed partials and
// cooperative cancellation. Kernels arrive as bytes at init and flow through
// the frames tier, so every product's provenance hash covers exactly this
// worker's pool, the published Walker ephemerides included.

import {
  accessJob,
  coverageJob,
  createComputeEnv,
  groundTrackJob,
  seriesJob,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
  type EngineJob,
  type JobHandle,
} from '@bessel/compute';
import wasmUrl from 'cspice-wasm/wasm/cspice.wasm?url';
import type {
  ComputeWorkerRequest,
  ComputeWorkerResponse,
  GrammarJobSpec,
  WalkerInit,
} from './compute-protocol.ts';

const MU_EARTH = 398600.4418; // km^3/s^2

let env: ComputeEnv | null = null;
const handles = new Map<number, JobHandle>();

const post = (msg: ComputeWorkerResponse): void => {
  (self as unknown as Worker).postMessage(msg);
};

/** Circular two-body J2000 states for one Walker plane, published as an SPK. */
function publishWalker(target: ComputeEnv, walker: WalkerInit): void {
  const n = Math.floor((2 * walker.spanS) / walker.stepS) + 1;
  const meanMotion = Math.sqrt(MU_EARTH / (walker.smaKm * walker.smaKm * walker.smaKm));
  for (let k = 0; k < walker.planes; k++) {
    const raan = (k * 2 * Math.PI) / walker.planes;
    const u0 = (k * Math.PI) / 6;
    const epochs = new Float64Array(n);
    const states = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) {
      const et = walker.epochEt - walker.spanS + i * walker.stepS;
      epochs[i] = et;
      const u = u0 + meanMotion * (et - walker.epochEt);
      const rp = [walker.smaKm * Math.cos(u), walker.smaKm * Math.sin(u), 0];
      const vp = [
        -walker.smaKm * meanMotion * Math.sin(u),
        walker.smaKm * meanMotion * Math.cos(u),
        0,
      ];
      const rot = (p: number[]): [number, number, number] => {
        const y1 = p[1]! * Math.cos(walker.incRad) - p[2]! * Math.sin(walker.incRad);
        const z1 = p[1]! * Math.sin(walker.incRad) + p[2]! * Math.cos(walker.incRad);
        return [
          p[0]! * Math.cos(raan) - y1 * Math.sin(raan),
          p[0]! * Math.sin(raan) + y1 * Math.cos(raan),
          z1,
        ];
      };
      const r = rot(rp);
      const v = rot(vp);
      states.set([r[0], r[1], r[2], v[0], v[1], v[2]], i * 6);
    }
    target.publishSpk({
      name: `grammar-walker-${k}.bsp`,
      body: walker.bodyBase - k,
      center: walker.centerBody,
      frame: 'J2000',
      segid: `GRAMMAR_WALKER_${k}`,
      degree: 7,
      epochs,
      states,
    });
  }
}

function buildJob(spec: GrammarJobSpec): EngineJob {
  switch (spec.kind) {
    case 'access':
      return accessJob(spec.request);
    case 'coverage':
      return coverageJob(spec.request);
    case 'series':
      return seriesJob(spec.request);
    case 'groundTrack':
      return groundTrackJob(spec.request);
  }
}

async function runJob(id: number, spec: GrammarJobSpec): Promise<void> {
  if (!env) {
    post({ kind: 'error', id, message: 'compute worker not initialized', cancelled: false });
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

self.onmessage = async (ev: MessageEvent<ComputeWorkerRequest>) => {
  const msg = ev.data;
  switch (msg.kind) {
    case 'init': {
      try {
        env = await createComputeEnv({ locateFile: () => wasmUrl });
        for (const k of msg.kernels) env.furnish(k.name, k.bytes);
        const et0 = env.frames.toEt(msg.epoch);
        if (msg.walker) publishWalker(env, { ...msg.walker, epochEt: et0 });
        post({ kind: 'ready', kernelSetHash: env.frames.kernels().setHash, et0 });
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
    case 'run':
      void runJob(msg.id, msg.job);
      break;
    case 'cancel':
      handles.get(msg.id)?.cancel();
      break;
  }
};
