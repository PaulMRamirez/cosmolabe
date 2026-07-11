// Conformance tests for the Session 6 emitters: the series job over the
// eval-series machinery and the ground-track geometry job over the sub-point
// path. Both stream chunked partials in order, honor the explicit correction,
// and their finals agree with the underlying primitives driven directly.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { runEvalSpec } from 'cspice-wasm';
import {
  createComputeEnv,
  groundTrackJob,
  seriesJob,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
  type JobProgress,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))),
  );

const FIXTURES = ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'];

async function collect(handle: { progress: AsyncIterable<JobProgress> }): Promise<JobProgress[]> {
  const events: JobProgress[] = [];
  for await (const e of handle.progress) events.push(e);
  return events;
}

describe('series and geometry emitters (M-0004)', () => {
  let env: ComputeEnv;
  let et0: number;

  beforeAll(async () => {
    env = await createComputeEnv();
    for (const name of FIXTURES) env.furnish(name, fixture(name));
    et0 = env.frames.toEt('2004-07-01T01:00:00');
  });

  it('seriesJob streams chunked partials and matches the interpreter driven directly', async () => {
    const span: [number, number] = [et0, et0 + 3600];
    const handle = submitJob(
      env,
      seriesJob({
        providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI' }],
        span,
        step: 60,
        frame: 'J2000',
        correction: 'NONE',
        chunks: 4,
      }),
    );
    const events = await collect(handle);
    const final = await handle.result;

    expect(events.length).toBe(5); // four chunk partials plus the final event
    const growth = events
      .map((e) => (e.partial!.product.kind === 'series' ? e.partial!.product.series[0]!.et.length : 0));
    expect(growth).toEqual([...growth].sort((a, b) => a - b)); // monotone materialization

    expect(final.product.kind).toBe('series');
    if (final.product.kind === 'series') {
      const s = final.product.series[0]!;
      expect(s.name).toBe('range (SATURN to CASSINI)');
      expect(s.unit).toBe('km');
      expect(final.units[s.name]).toBe('km');
      const direct = await runEvalSpec(env.engine, {
        grid: { start: span[0], stop: span[1], step: 60 },
        providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI', abcorr: 'NONE' }],
      });
      expect(s.et).toEqual(direct.et);
      expect(s.values).toEqual(direct.columns[0]!);
    }
    expect(final.provenance.engine).toBe('series');
    expect(final.provenance.frame).toBe('J2000');
  });

  it('seriesJob refuses a provider whose frame disagrees with the frame of record', () => {
    expect(() =>
      seriesJob({
        providers: [{ kind: 'position', observer: 'SATURN', target: 'CASSINI', frame: 'ECLIPJ2000' }],
        span: [et0, et0 + 60],
        step: 60,
        frame: 'J2000',
        correction: 'NONE',
      }),
    ).toThrow(/frame of record/);
  });

  it('groundTrackJob streams a polyline that lies on the body and matches subpnt', async () => {
    const handle = submitJob(
      env,
      groundTrackJob({
        body: 'SATURN',
        satellite: 'CASSINI',
        bodyFrame: 'IAU_SATURN',
        span: [et0, et0 + 3600],
        step: 300,
        correction: 'NONE',
        chunks: 3,
      }),
    );
    const events = await collect(handle);
    const final = await handle.result;

    expect(events.length).toBe(4); // three chunk partials plus the final event
    if (events[0]!.partial!.product.kind === 'geometry') {
      const first = events[0]!.partial!.product.layers[0]!;
      expect(first.form).toBe('polyline');
      expect(first.positions.length % 3).toBe(0);
      expect(first.positions.length).toBeLessThan(13 * 3);
    }

    expect(final.product.kind).toBe('geometry');
    if (final.product.kind === 'geometry') {
      const layer = final.product.layers[0]!;
      expect(layer.frame).toBe('IAU_SATURN');
      expect(layer.positions.length).toBe(13 * 3);
      // Every vertex sits on Saturn's ellipsoid (equatorial 60268, polar 54364 km).
      for (let i = 0; i < layer.positions.length; i += 3) {
        const r = Math.hypot(layer.positions[i]!, layer.positions[i + 1]!, layer.positions[i + 2]!);
        expect(r).toBeGreaterThan(54000);
        expect(r).toBeLessThan(60500);
      }
      const direct = await env.engine.subpnt(
        'NEAR POINT/ELLIPSOID',
        'SATURN',
        et0,
        'IAU_SATURN',
        'NONE',
        'CASSINI',
      );
      expect(layer.positions[0]).toBe(direct.point.x);
      expect(layer.positions[1]).toBe(direct.point.y);
      expect(layer.positions[2]).toBe(direct.point.z);
    }
    expect(final.provenance.engine).toBe('groundTrack');
    expect(final.units).toEqual({ positions: 'km' });
  });

  it('cancels a series job between chunks', async () => {
    const handle = submitJob(
      env,
      seriesJob({
        providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI' }],
        span: [et0, et0 + 4 * 3600],
        step: 10,
        frame: 'J2000',
        correction: 'NONE',
        chunks: 16,
      }),
    );
    for await (const e of handle.progress) {
      if (e.partial) {
        handle.cancel();
        break;
      }
    }
    await expect(handle.result).rejects.toThrow(JobCancelledError);
  });
});
