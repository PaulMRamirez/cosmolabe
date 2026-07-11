// Conformance tests for the compute plane (ADR M-0004): the product schema,
// the authority rule (loud, not conventional), cancellation, partial
// streaming order, and provenance whose kernel set hash is the frames tier's
// own. The end-to-end tests drive the real access and coverage engines over
// the committed Cassini SOI fixtures through one shared compute environment.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createFramesLayer } from '@cosmolabe/frames';
import {
  accessJob,
  coverageJob,
  createComputeEnv,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
  type EngineJob,
  type JobProgress,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))),
  );

const FIXTURES = ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'];

/** A synthetic three-step job for protocol-only tests (no SPICE). */
function syntheticJob(onStep?: () => Promise<void>): EngineJob {
  return {
    engine: 'synthetic',
    version: '0.0.0',
    frame: 'J2000',
    correction: 'NONE',
    units: { intervals: 's (ET)' },
    async *run(ctx) {
      for (let i = 1; i <= 3; i++) {
        ctx.throwIfCancelled();
        await (onStep?.() ?? Promise.resolve());
        yield {
          pct: (100 * i) / 3,
          partial: { kind: 'intervals', sets: [{ label: `step-${i}`, intervals: [[0, i]] }] },
        };
      }
      return { kind: 'intervals', sets: [{ label: 'final', intervals: [[0, 3]] }] };
    },
  };
}

async function collect(handle: { progress: AsyncIterable<JobProgress> }): Promise<JobProgress[]> {
  const events: JobProgress[] = [];
  for await (const e of handle.progress) events.push(e);
  return events;
}

describe('compute plane job protocol (M-0004)', () => {
  let env: ComputeEnv;
  let et0: number;

  beforeAll(async () => {
    env = await createComputeEnv();
    for (const name of FIXTURES) env.furnish(name, fixture(name));
    et0 = env.frames.toEt('2004-07-01T00:00:00');
  });

  it('streams partials in order, ends with the final product at pct 100', async () => {
    const handle = submitJob(env, syntheticJob());
    const events = await collect(handle);
    expect(events.map((e) => Math.round(e.pct))).toEqual([33, 67, 100, 100]);
    const final = await handle.result;
    expect(events[events.length - 1]!.partial).toEqual(final);
    // Every partial is a complete AnalysisProduct with the job's units and
    // the one provenance block.
    for (const e of events) {
      expect(e.partial!.units).toEqual({ intervals: 's (ET)' });
      expect(e.partial!.provenance).toEqual(final.provenance);
    }
  });

  it('stamps provenance from the frames tier with authority exploratory', async () => {
    const final = await submitJob(env, syntheticJob()).result;
    const p = final.provenance;
    expect(p.engine).toBe('synthetic');
    expect(p.version).toBe('0.0.0');
    expect(p.frame).toBe('J2000');
    expect(p.correction).toBe('NONE');
    expect(p.authority).toBe('exploratory');
    expect(p.jobId).toMatch(/^synthetic-\d+$/);
    expect(Number.isNaN(Date.parse(p.computedAt))).toBe(false);
    // The kernel set hash is the frames tier's own, and reproducible by an
    // independent frames layer over the same bytes (the seam tables' source).
    expect(p.kernels.setHash).toBe(env.frames.kernels().setHash);
    expect(p.kernels.names).toEqual(FIXTURES);
    const independent = await createFramesLayer();
    for (const name of FIXTURES) independent.furnish(name, fixture(name));
    expect(p.kernels.setHash).toBe(independent.kernels().setHash);
  });

  it('refuses a job that carries an authority property (iron rule 4, loudly)', () => {
    const smuggler = { ...syntheticJob(), authority: 'host' } as unknown as EngineJob;
    expect(() => submitJob(env, smuggler)).toThrow(/authority/);
  });

  it('cancels cooperatively: result rejects, progress ends', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = submitJob(env, syntheticJob(() => gate));
    handle.cancel();
    release();
    await expect(handle.result).rejects.toThrow(JobCancelledError);
    const events = await collect(handle);
    expect(events.length).toBe(0);
  });

  it('runs the access engine end to end: one lane per target, streamed in order', async () => {
    const handle = submitJob(
      env,
      accessJob({
        observer: 'SATURN',
        targets: ['CASSINI', 'SUN'],
        span: [et0, et0 + 4 * 3600],
        step: 3600,
        constraints: [{ kind: 'range', maxKm: 2.0e5 }],
        correction: 'NONE',
      }),
    );
    const events = await collect(handle);
    const final = await handle.result;

    // Two per-target partials plus the final event.
    expect(events.length).toBe(3);
    expect(events[0]!.pct).toBe(50);
    const firstPartial = events[0]!.partial!.product;
    expect(firstPartial.kind).toBe('intervals');
    if (firstPartial.kind === 'intervals') {
      expect(firstPartial.sets.map((s) => s.label)).toEqual(['CASSINI']);
    }

    expect(final.product.kind).toBe('intervals');
    if (final.product.kind === 'intervals') {
      const [cassini, sun] = final.product.sets;
      expect(cassini!.label).toBe('CASSINI');
      // Cassini sits inside 2e5 km of Saturn across the SOI window (the
      // fixture SPK's coverage begins shortly after midnight, so the window
      // starts at coverage start, inside the span, and spans hours).
      expect(cassini!.intervals.length).toBeGreaterThan(0);
      const [aStart, aEnd] = cassini!.intervals[0]!;
      expect(aStart).toBeGreaterThanOrEqual(et0);
      expect(aEnd).toBeLessThanOrEqual(et0 + 4 * 3600);
      expect(aEnd - aStart).toBeGreaterThan(3600);
      // The Sun is 9 au out: an empty lane, honestly reported.
      expect(sun!.label).toBe('SUN');
      expect(sun!.intervals.length).toBe(0);
    }
    expect(final.provenance.engine).toBe('access');
    expect(final.provenance.correction).toBe('NONE');
    expect(final.provenance.kernels.setHash).toBe(env.frames.kernels().setHash);
  });

  it('runs the coverage engine end to end: the field fills in row by row', async () => {
    const handle = submitJob(
      env,
      coverageJob({
        grid: {
          body: 'SATURN',
          bodyFrame: 'IAU_SATURN',
          latMin: -0.5,
          latMax: 0.5,
          latCount: 2,
          lonMin: 0,
          lonMax: 1,
          lonCount: 3,
        },
        assets: ['CASSINI'],
        span: [et0, et0 + 4 * 3600],
        step: 3600,
        minElevationRad: 0,
        correction: 'NONE',
      }),
    );
    const events = await collect(handle);
    const final = await handle.result;

    // Two row partials (pct 50, 100) plus the final event.
    expect(events.map((e) => Math.round(e.pct))).toEqual([50, 100, 100]);
    const row1 = events[0]!.partial!.product;
    expect(row1.kind).toBe('field');
    if (row1.kind === 'field') {
      const v = row1.field.values;
      expect(v.length).toBe(6);
      // First row resolved, second row still NaN: materialization, honestly.
      expect(v.slice(0, 3).every(Number.isFinite)).toBe(true);
      expect(v.slice(3).every(Number.isNaN)).toBe(true);
    }

    expect(final.product.kind).toBe('field');
    if (final.product.kind === 'field') {
      const f = final.product.field;
      expect(f.name).toBe('percentCoverage');
      expect(f.values.length).toBe(6);
      expect([...f.values].every(Number.isFinite)).toBe(true);
      expect([...f.values].every((x) => x >= 0 && x <= 100)).toBe(true);
      // A Saturn-surface point sees Cassini near SOI for part of the window.
      expect(Math.max(...f.values)).toBeGreaterThan(0);
    }
    expect(final.provenance.frame).toBe('IAU_SATURN');
    expect(final.units).toEqual({ percentCoverage: 'percent' });
  });

  it('cancels a running coverage sweep between cells', async () => {
    const handle = submitJob(
      env,
      coverageJob({
        grid: {
          body: 'SATURN',
          bodyFrame: 'IAU_SATURN',
          latMin: -1,
          latMax: 1,
          latCount: 8,
          lonMin: 0,
          lonMax: 3,
          lonCount: 8,
        },
        assets: ['CASSINI'],
        span: [et0, et0 + 4 * 3600],
        step: 3600,
        minElevationRad: 0,
        correction: 'NONE',
      }),
    );
    // Cancel as soon as the first row partial arrives.
    for await (const e of handle.progress) {
      if (e.partial) {
        handle.cancel();
        break;
      }
    }
    await expect(handle.result).rejects.toThrow(JobCancelledError);
  });
});
