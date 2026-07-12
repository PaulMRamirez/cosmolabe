// The porkchop emitter behind JobHandle: real frames-tier states over the
// GS-2 era fixtures (the Earth to Mars barycenter window the app's
// mission-design defaults keep inside the bundled inner-system SPK), one
// streamed grid-field partial per departure column, NaN as both the
// not-yet-swept marker and the honest Lambert gap, cooperative cancel, and
// the wire encoding round-tripping the grid domain bit-exact.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createComputeEnv,
  decodeAnalysisProduct,
  encodeAnalysisProduct,
  porkchopJob,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
} from './index.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))),
  );

const KERNELS = ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp'];
const DAY = 86400;
const SUN_MU = 1.32712440018e11; // km^3/s^2, NAIF/DE440 published constant

const request = (et0: number) => ({
  departureBody: 'EARTH',
  arrivalBody: 'MARS BARYCENTER',
  centerBody: 'SUN',
  frame: 'J2000',
  correction: 'NONE' as const,
  mu: SUN_MU,
  departure: { start: et0, end: et0 + 30 * DAY, count: 6 },
  tof: { start: 90 * DAY, end: 150 * DAY, count: 5 },
});

describe('porkchopJob (field kind, grid domain, M-0004 amendment 1)', () => {
  let env: ComputeEnv;
  let et0: number;

  beforeAll(async () => {
    env = await createComputeEnv();
    for (const name of KERNELS) env.furnish(name, fixture(name));
    et0 = env.frames.toEt('2004-07-01T00:00:00');
  });

  it('streams one grid partial per departure column and resolves the full surface', async () => {
    const handle = submitJob(env, porkchopJob(request(et0)));
    let partials = 0;
    let firstPartialTailNaN = false;
    for await (const e of handle.progress) {
      if (!e.partial) continue;
      partials++;
      const p = e.partial.product;
      if (p.kind !== 'field' || p.field.domain !== 'grid') throw new Error('expected grid field');
      expect(p.field.x.count).toBe(6);
      expect(p.field.y.count).toBe(5);
      if (partials === 1) {
        // Column 0 resolved; the last column is still NaN (not yet swept).
        firstPartialTailNaN = Number.isNaN(p.field.values[5]!);
      }
    }
    // Six column partials plus the runner's final echo (submitJob delivers
    // the finished product as the pct-100 partial too).
    expect(partials).toBe(7);
    expect(firstPartialTailNaN).toBe(true);

    const final = await handle.result;
    expect(final.provenance.authority).toBe('exploratory');
    expect(final.provenance.engine).toBe('porkchop');
    const p = final.product;
    if (p.kind !== 'field' || p.field.domain !== 'grid') throw new Error('expected grid field');
    expect(p.field.x.name).toBe('departure epoch');
    expect(p.field.y.name).toBe('time of flight');
    expect(p.field.unit).toBe('km/s');
    expect(p.field.values).toHaveLength(30);
    const finite = Array.from(p.field.values).filter((v) => Number.isFinite(v));
    // The canonical Earth to Mars window solves nearly everywhere; the
    // minimum departure delta-v is physically plausible (single digits to
    // low tens of km/s about the Sun).
    expect(finite.length).toBeGreaterThanOrEqual(20);
    const min = Math.min(...finite);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(50);
  });

  it('cancels cooperatively between departure columns', async () => {
    const handle = submitJob(env, porkchopJob(request(et0)));
    let partials = 0;
    const consume = (async () => {
      for await (const e of handle.progress) {
        if (e.partial && ++partials === 1) handle.cancel();
      }
    })();
    await expect(handle.result).rejects.toThrow(JobCancelledError);
    await consume;
    expect(partials).toBeLessThan(6);
  });

  it('cancels within one column at a production-scale grid (60 by 60, the scale assertion)', async () => {
    // The posture stated in the job doc block, pinned at scale: the cancel
    // check is per departure column, so a cancel issued at the first
    // streamed partial must land far short of the 60-column sweep.
    const handle = submitJob(
      env,
      porkchopJob({
        ...request(et0),
        departure: { start: et0, end: et0 + 30 * DAY, count: 60 },
        tof: { start: 90 * DAY, end: 150 * DAY, count: 60 },
      }),
    );
    let partials = 0;
    const consume = (async () => {
      for await (const e of handle.progress) {
        if (e.partial && ++partials === 1) handle.cancel();
      }
    })();
    await expect(handle.result).rejects.toThrow(JobCancelledError);
    await consume;
    expect(partials).toBeLessThan(5);
  });

  it('round-trips the grid domain through the wire encoding bit-exact', async () => {
    const handle = submitJob(env, porkchopJob(request(et0)));
    const final = await handle.result;
    const decoded = decodeAnalysisProduct(encodeAnalysisProduct(final));
    const a = final.product;
    const b = decoded.product;
    if (a.kind !== 'field' || b.kind !== 'field') throw new Error('kind changed');
    if (a.field.domain !== 'grid' || b.field.domain !== 'grid') throw new Error('domain changed');
    expect(b.field.x).toEqual(a.field.x);
    expect(b.field.y).toEqual(a.field.y);
    for (let i = 0; i < a.field.values.length; i++) {
      expect(Object.is(a.field.values[i], b.field.values[i])).toBe(true);
    }
  });
});
