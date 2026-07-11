// Substrate conformance: the property that broke in Session 6, pinned where
// it broke. A worker delivers cancel as a macrotask message, so a running job
// must let macrotasks through mid-stream or cancellation starves; this test
// cancels a large in-process coverage job FROM a macrotask (exactly a
// message's delivery path) and requires the rejection to land mid-stream,
// which only happens if the sweep's time-budgeted yields run. The wire
// client is exercised over a same-thread fake worker so the protocol
// round-trips without a DOM Worker (node has none); the real-worker path is
// observed by the app's Playwright spec.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  coverageJob,
  createComputeEnv,
  submitJob,
  JobCancelledError,
  JobClient,
  JobClientCancelled,
  type ComputeEnv,
  type SubstrateRequest,
  type SubstrateResponse,
  type SubstrateWorker,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))),
  );

const FIXTURES = ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'];

const bigFieldJob = (et0: number) =>
  coverageJob({
    grid: {
      body: 'SATURN',
      bodyFrame: 'IAU_SATURN',
      latMin: -1.2,
      latMax: 1.2,
      latCount: 24,
      lonMin: -Math.PI,
      lonMax: Math.PI * (1 - 2 / 32),
      lonCount: 32,
    },
    assets: ['CASSINI'],
    span: [et0, et0 + 4 * 3600],
    step: 3600,
    minElevationRad: 0,
    correction: 'NONE',
  });

describe('worker substrate conformance', () => {
  let env: ComputeEnv;
  let et0: number;

  beforeAll(async () => {
    env = await createComputeEnv();
    for (const name of FIXTURES) env.furnish(name, fixture(name));
    et0 = env.frames.toEt('2004-07-01T00:00:00');
  });

  it('a macrotask-delivered cancel lands mid-stream (the starvation pin)', async () => {
    const handle = submitJob(env, bigFieldJob(et0));
    let partials = 0;
    let cancelQueued = false;
    const consume = (async () => {
      for await (const e of handle.progress) {
        if (!e.partial) continue;
        partials++;
        // Deliver the cancel the way a worker message arrives: as a macrotask
        // queued while the job computes, anchored to the stream (after the
        // first partial) rather than to wall clock, so the test is not a race
        // against a slow runner. If the sweep never yielded the event loop,
        // this timeout could not fire until the job finished and the
        // cancellation would be too late (partials would reach all 24 rows).
        if (!cancelQueued) {
          cancelQueued = true;
          setTimeout(() => handle.cancel(), 0);
        }
      }
    })();
    await expect(handle.result).rejects.toThrow(JobCancelledError);
    await consume;
    // Mid-stream, honestly: the job neither finished nor died instantly.
    expect(partials).toBeGreaterThan(0);
    expect(partials).toBeLessThan(24);
  });

  it('round-trips the substrate protocol over a same-thread worker fake', async () => {
    // A fake worker: the client's messages drive a job against the shared
    // env; responses come back through the message listener, exercising the
    // protocol types and the client's pending-run bookkeeping end to end.
    const listeners = new Set<(ev: MessageEvent<SubstrateResponse>) => void>();
    const emit = (msg: SubstrateResponse): void => {
      for (const l of listeners) l({ data: msg } as MessageEvent<SubstrateResponse>);
    };
    const fake: SubstrateWorker = {
      postMessage(message: SubstrateRequest): void {
        if (message.kind === 'init') {
          emit({ kind: 'ready', kernelSetHash: env.frames.kernels().setHash, et0 });
        } else if (message.kind === 'run') {
          const handle = submitJob(env, bigFieldJob(et0));
          void (async () => {
            try {
              for await (const e of handle.progress) {
                emit({ kind: 'progress', id: message.id, pct: e.pct, partial: e.partial });
              }
              emit({ kind: 'result', id: message.id, product: await handle.result });
            } catch (err) {
              emit({
                kind: 'error',
                id: message.id,
                message: String(err),
                cancelled: err instanceof JobCancelledError,
              });
            }
          })();
          fakeCancel = () => handle.cancel();
        } else if (message.kind === 'cancel') {
          fakeCancel?.();
        }
      },
      addEventListener: (_t, l) => void listeners.add(l),
      removeEventListener: (_t, l) => void listeners.delete(l),
      terminate: () => listeners.clear(),
    };
    let fakeCancel: (() => void) | null = null;

    const client = new JobClient(fake, { kernels: [] });
    const { kernelSetHash } = await client.ready;
    expect(kernelSetHash).toBe(env.frames.kernels().setHash);

    let sawProgress = 0;
    const run = client.run(
      {
        kind: 'coverage',
        request: {
          grid: {
            body: 'SATURN',
            bodyFrame: 'IAU_SATURN',
            latMin: -1.2,
            latMax: 1.2,
            latCount: 24,
            lonMin: -Math.PI,
            lonMax: Math.PI * (1 - 2 / 32),
            lonCount: 32,
          },
          assets: ['CASSINI'],
          span: [et0, et0 + 4 * 3600],
          step: 3600,
          minElevationRad: 0,
          correction: 'NONE',
        },
      },
      (e) => {
        sawProgress++;
        if (e.partial && sawProgress === 2) run.cancel();
      },
    );
    await expect(run.result).rejects.toThrow(JobClientCancelled);
    expect(sawProgress).toBeGreaterThan(0);
    client.dispose();
  });
});
