// Phase B (catalog trajectory wiring): every non-SPICE trajectory type must sample
// into a position table through the existing @bessel/propagator and interpolation
// engines, so a Keplerian, TLE, Fixed, or Sampled spacecraft renders as a polyline.
// Uses the real CSPICE engine with fixture kernels (as the propagator tests do) and a
// mock PAL FileSystem for the Sampled reader.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import type { FileSystem } from '@bessel/pal';
import { sampleTrajectory, trajectoryGrid, tablePoints, TrajectoryError } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

/** A TLE for Vanguard 1, the canonical SGP4 reference object (Vallado AIAA-2006-6753). */
const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

/** A read-only PAL FileSystem backed by an in-memory map, for the Sampled reader. */
function mockFs(files: Record<string, string>): FileSystem {
  return {
    readFile: async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`mock fs: no file "${path}"`);
      return new TextEncoder().encode(text);
    },
    writeFile: async () => {},
    exists: async (path: string) => path in files,
    remove: async () => {},
    list: async () => Object.keys(files),
  };
}

const radius = (p: readonly [number, number, number]) => Math.hypot(p[0], p[1], p[2]);

/** Earth GM (km^3/s^2): the fixture PCK carries no BODY399_GM, so tests pass mu. */
const GM_EARTH = 398600.435436;

describe('catalog trajectory samplers (real SPICE, mock PAL)', () => {
  let spice: SpiceEngine;
  let et0: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    et0 = await spice.str2et('2005-01-01T00:00:00');
  });

  it('Keplerian: a circular orbit holds a near-constant radius over a period', async () => {
    // a = 7000 km circular (e = 0) about the Earth; the radius must stay ~a all the way.
    const a = 7000;
    const grid = trajectoryGrid(et0, et0 + 6000, 64); // ~one ~97 min LEO period
    const table = await sampleTrajectory(
      spice,
      undefined,
      {
        type: 'Keplerian',
        center: '399',
        mu: GM_EARTH,
        elements: { a, e: 0, i: 0.5, raan: 0.2, argp: 0, m0: 0, epoch: '2005-01-01T00:00:00' },
      },
      grid,
      'KepSat',
      '-9001',
    );
    const points = tablePoints(table);
    expect(points.length).toBe(64);
    for (const p of points) expect(radius(p)).toBeCloseTo(a, -1); // within ~10 km of a
  });

  it('Keplerian: an eccentric orbit ranges between periapsis and apoapsis radii', async () => {
    const a = 10000;
    const e = 0.2;
    const grid = trajectoryGrid(et0, et0 + 12000, 96);
    const table = await sampleTrajectory(
      spice,
      undefined,
      {
        type: 'Keplerian',
        center: '399',
        mu: GM_EARTH,
        elements: { a, e, i: 0.3, raan: 0, argp: 0, m0: 0, epoch: '2005-01-01T00:00:00' },
      },
      grid,
      'EccSat',
      '-9002',
    );
    const radii = tablePoints(table).map(radius);
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    expect(min).toBeGreaterThan(a * (1 - e) - 50);
    expect(max).toBeLessThan(a * (1 + e) + 50);
    expect(max - min).toBeGreaterThan(100); // it actually varies (not a degenerate line)
  });

  it('Keplerian: fails loudly when neither mu nor a PCK GM resolves the center', async () => {
    // The fixture PCK has no BODY399_GM, so without an explicit mu the central GM is
    // unresolvable and the sampler must fail loudly rather than guess.
    const grid = trajectoryGrid(et0, et0 + 6000, 8);
    await expect(
      sampleTrajectory(
        spice,
        undefined,
        {
          type: 'Keplerian',
          center: '399',
          elements: { a: 7000, e: 0, i: 0, raan: 0, argp: 0, m0: 0, epoch: '2005-01-01T00:00:00' },
        },
        grid,
        'NoGm',
        '-9009',
      ),
    ).rejects.toThrow(/GM .* is not resolvable/);
  });

  it('Tle: produces a finite J2000 track at a plausible orbital radius', async () => {
    const grid = trajectoryGrid(et0, et0 + 6000, 48);
    const table = await sampleTrajectory(
      spice,
      undefined,
      { type: 'Tle', center: '399', line1: L1, line2: L2 },
      grid,
      'Vanguard',
      '-9003',
    );
    const points = tablePoints(table);
    expect(points.length).toBe(48);
    for (const p of points) {
      expect(p.every(Number.isFinite)).toBe(true);
      // Vanguard 1 is a 654 x 3933 km orbit, so its geocentric radius stays well above
      // the Earth's surface and below a generous bound.
      const r = radius(p);
      expect(r).toBeGreaterThan(6800);
      expect(r).toBeLessThan(12000);
    }
    // The track is not a single repeated point: it sweeps real distance.
    expect(radius([points[0]![0] - points[24]![0], points[0]![1] - points[24]![1], points[0]![2] - points[24]![2]])).toBeGreaterThan(100);
  });

  it('Fixed: emits the constant position at every step', async () => {
    const grid = trajectoryGrid(et0, et0 + 3600, 10);
    const table = await sampleTrajectory(
      spice,
      undefined,
      { type: 'Fixed', center: '399', position: [1000, -2000, 3000] },
      grid,
      'Beacon',
      '-9004',
    );
    for (const p of tablePoints(table)) expect(p).toEqual([1000, -2000, 3000]);
  });

  it('Sampled (xyz): linearly interpolates a known table read through the PAL', async () => {
    // Two states 100 s apart; the midpoint must be the average position.
    const t0 = '2005-01-01T00:00:00';
    const t1 = '2005-01-01T00:01:40'; // +100 s
    const fs = mockFs({
      '/sat.xyz': `# epoch x y z\n${t0} 1000 0 0\n${t1} 2000 100 -50\n`,
    });
    const e1 = await spice.str2et(t1.replace(/Z$/, ''));
    const grid = Float64Array.from([et0, (et0 + e1) / 2, e1]);
    const table = await sampleTrajectory(
      spice,
      fs,
      { type: 'Sampled', center: '399', source: '/sat.xyz', format: 'xyz' },
      grid,
      'SampledSat',
      '-9005',
    );
    const points = tablePoints(table);
    expect(points[0]).toEqual([1000, 0, 0]);
    expect(points[1]![0]).toBeCloseTo(1500, 6);
    expect(points[1]![1]).toBeCloseTo(50, 6);
    expect(points[1]![2]).toBeCloseTo(-25, 6);
    expect(points[2]).toEqual([2000, 100, -50]);
  });

  it('Sampled (oem): reads a CCSDS OEM through the PAL and interpolates position', async () => {
    const oem = [
      'CCSDS_OEM_VERS = 2.0',
      'META_START',
      'REF_FRAME = EME2000',
      'META_STOP',
      '2005-01-01T00:00:00 6678.0 0.0 0.0 0.0 7.726 0.0',
      '2005-01-01T00:01:40 6700.0 50.0 -10.0 0.0 7.7 0.1',
    ].join('\n');
    const fs = mockFs({ '/sat.oem': oem });
    const e1 = await spice.str2et('2005-01-01T00:01:40');
    const grid = Float64Array.from([et0, e1]);
    const table = await sampleTrajectory(
      spice,
      fs,
      { type: 'Sampled', center: '399', source: '/sat.oem', format: 'oem' },
      grid,
      'OemSat',
      '-9006',
    );
    const points = tablePoints(table);
    expect(points[0]).toEqual([6678.0, 0.0, 0.0]);
    expect(points[1]).toEqual([6700.0, 50.0, -10.0]);
  });

  it('fails loudly with a located TrajectoryError on a malformed TLE', async () => {
    const grid = trajectoryGrid(et0, et0 + 3600, 4);
    await expect(
      sampleTrajectory(spice, undefined, { type: 'Tle', line1: 'garbage', line2: 'garbage' }, grid, 'X', '-9'),
    ).rejects.toBeInstanceOf(TrajectoryError);
  });

  it('fails loudly when a Sampled trajectory has no PAL FileSystem', async () => {
    const grid = trajectoryGrid(et0, et0 + 3600, 4);
    await expect(
      sampleTrajectory(spice, undefined, { type: 'Sampled', source: '/x.xyz' }, grid, 'X', '-9'),
    ).rejects.toThrow(/no PAL FileSystem/);
  });

  it('fails loudly when a Sampled source is missing', async () => {
    const grid = trajectoryGrid(et0, et0 + 3600, 4);
    await expect(
      sampleTrajectory(spice, mockFs({}), { type: 'Sampled', source: '/missing.xyz' }, grid, 'X', '-9'),
    ).rejects.toThrow(/cannot read source/);
  });
});
