// Phase B scene-builder routing: buildCatalogMissionScene must route a spacecraft's
// non-SPICE trajectory (Keplerian, TLE, Fixed, Sampled) through the trajectory
// resolver so it renders a non-empty polyline, with the SPICE path untouched for
// SPICE arcs. Rendering is asserted here by the produced polyline (CLAUDE.md: a test
// asserts it, never judgement). Real CSPICE with fixture kernels; mock PAL for Sampled.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import type { FileSystem } from '@bessel/pal';
import type { BesselCatalog, Trajectory } from '@bessel/catalog';
import { buildCatalogMissionScene } from '../generic-mission.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const GM_EARTH = 398600.435436;
// Inside the de440s-inner-cassini fixture coverage (the bundled Cassini-era window).
const WINDOW = { start: '2004-07-01T00:00:00', stop: '2004-07-01T03:00:00' };

const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

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

function craftCatalog(trajectory: Trajectory): BesselCatalog {
  return {
    version: '1.0',
    bodies: [{ id: '399', name: 'Earth' }],
    spacecraft: [
      {
        id: '-9100',
        name: 'Sat',
        trajectory,
        arcs: [{ timeRange: WINDOW, trajectory: { type: 'Spice' } }],
      },
    ],
  };
}

describe('buildCatalogMissionScene routes non-SPICE trajectories to a polyline', () => {
  let spice: SpiceEngine;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
  });

  it('renders a Keplerian trajectory as a non-empty polyline anchored to its center', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({
        type: 'Keplerian',
        center: '399',
        mu: GM_EARTH,
        elements: { a: 7000, e: 0, i: 0.9, raan: 0, argp: 0, m0: 0, epoch: WINDOW.start },
      }),
    );
    const points = mission.spec.trajectory?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
    // The polyline traces an orbit: every point sits at ~the orbit radius.
    for (const p of points) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(7000, -2);
    expect(mission.table.byBody.has('Sat')).toBe(true);
  });

  it('renders a TLE trajectory as a non-empty polyline', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ type: 'Tle', center: '399', line1: L1, line2: L2 }),
    );
    const points = mission.spec.trajectory?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
    for (const p of points) expect(p.every(Number.isFinite)).toBe(true);
    expect(mission.table.byBody.has('Sat')).toBe(true);
  });

  it('renders a Fixed trajectory as a constant non-empty polyline', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ type: 'Fixed', center: '399', position: [8000, 0, 0] }),
    );
    const points = mission.spec.trajectory?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
    for (const p of points) expect(p).toEqual([8000, 0, 0]);
  });

  it('renders a Sampled trajectory read through the PAL as a non-empty polyline', async () => {
    const fs = mockFs({
      '/sat.xyz': `${WINDOW.start} 7000 0 0\n2004-07-01T01:30:00 0 7000 0\n${WINDOW.stop} -7000 0 0\n`,
    });
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ type: 'Sampled', center: '399', source: '/sat.xyz', format: 'xyz' }),
      undefined,
      fs,
    );
    const points = mission.spec.trajectory?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
    // The track is finite and within the chord envelope of the ~7000 km state file
    // (the builder may pad the window, so the exact endpoint is not asserted).
    for (const p of points) {
      expect(p.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(p[0], p[1], p[2])).toBeLessThanOrEqual(7001);
    }
    // It actually moves: first and last samples differ.
    const first = points[0]!;
    const last = points[points.length - 1]!;
    expect(Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2])).toBeGreaterThan(100);
    expect(mission.table.byBody.has('Sat')).toBe(true);
  });

  it('still routes a SPICE arc through the existing fast path (Earth about the Sun)', async () => {
    // A SPICE spacecraft would normally need its own kernel, but a body trajectory of
    // type Spice exercises the unchanged path: Earth sampled about the Sun renders.
    const mission = await buildCatalogMissionScene(spice, {
      version: '1.0',
      bodies: [{ id: '399', name: 'Earth' }],
      spacecraft: [
        {
          id: '399',
          name: 'Earth-as-craft',
          trajectory: { type: 'Spice', center: '10' },
          arcs: [{ timeRange: WINDOW, trajectory: { type: 'Spice' } }],
        },
      ],
    });
    const points = mission.spec.trajectory?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
  });
});
