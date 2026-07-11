// Item 1 (arbitrary-mission load): the generic catalog-driven scene builder must
// turn a native catalog into a SceneSpec by sampling SPICE for its bodies and
// spacecraft and mapping every geometry type, with no Cassini hardcode.

import { describe, it, expect } from 'vitest';
import type { BesselCatalog } from '@bessel/catalog';
import type { SpiceEngine } from '@bessel/spice';
import {
  bodyRadiusKm,
  catalogBodyToPlanetDef,
  ringSpecFromGeometry,
  swarmSpecFromGeometry,
  particleSpecFromGeometry,
  assembleSceneSpec,
  buildCatalogMissionScene,
} from './generic-mission.ts';

// A deterministic mock SPICE engine: str2et parses a YYYY offset to seconds, and
// spkpos returns a fixed per-body vector so sampling is reproducible.
function mockSpice(): SpiceEngine {
  const engine = {
    str2et: async (utc: string) => (utc.startsWith('2010') ? 100 : 0),
    spkpos: async (target: string, _et: number) => {
      const base = target.length;
      return { position: { x: base * 1000, y: base * 10, z: base }, lightTime: 0 };
    },
  };
  return engine as unknown as SpiceEngine;
}

const NATIVE: BesselCatalog = {
  name: 'Test Mission',
  version: '1.0',
  bodies: [
    {
      id: 'Saturn',
      name: 'Saturn',
      geometry: {
        type: 'Globe',
        radii: [60268, 60268, 54364],
        rings: { type: 'Rings', innerRadius: 74500, outerRadius: 140220 },
      },
    },
    { id: 'belt', name: 'Belt', geometry: { type: 'KeplerianSwarm', color: '#ffaa00' } },
  ],
  spacecraft: [
    {
      id: 'Probe',
      name: 'Probe',
      trajectory: { type: 'Spice', center: 'Saturn' },
      arcs: [{ timeRange: { start: '2000-01-01', stop: '2010-01-01' }, trajectory: { type: 'Spice' } }],
    },
  ],
};

describe('catalog body mapping', () => {
  it('derives a mean radius from explicit Globe radii', () => {
    expect(bodyRadiusKm(NATIVE.bodies![0]!)).toBeCloseTo((60268 + 60268 + 54364) / 3, 3);
  });

  it('falls back to a default radius without geometry', () => {
    expect(bodyRadiusKm({ id: 'X' })).toBe(1000);
  });

  it('reuses a known inner-system color for a recognised body', () => {
    const def = catalogBodyToPlanetDef({ id: 'Earth', name: 'Earth' });
    expect(def.spiceId).toBe('Earth');
    expect(def.color).not.toEqual([0.6, 0.62, 0.66]);
  });

  it('plumbs a Globe image base-map and normal map into the PlanetDef', () => {
    const def = catalogBodyToPlanetDef({
      id: 'Mars',
      name: 'Mars',
      geometry: { type: 'Globe', texture: 'mars.jpg', normalMap: 'mars_normal.jpg' },
    });
    expect(def.texture).toBe('mars.jpg');
    expect(def.normalMap).toBe('mars_normal.jpg');
  });
});

describe('geometry -> spec mapping', () => {
  it('maps a Globe.rings sub-spec to a RingSpec', () => {
    const ring = ringSpecFromGeometry('Saturn', NATIVE.bodies![0]!.geometry!);
    expect(ring).toEqual({ body: 'Saturn', innerKm: 74500, outerKm: 140220 });
  });

  it('rejects rings with outer <= inner', () => {
    expect(ringSpecFromGeometry('B', { type: 'Rings', innerRadius: 100, outerRadius: 50 })).toBeNull();
  });

  it('carries a ring image texture through to the ring spec', () => {
    const ring = ringSpecFromGeometry('Saturn', {
      type: 'Rings',
      innerRadius: 1,
      outerRadius: 2,
      texture: 'rings.png',
    });
    expect(ring?.texture).toBe('rings.png');
  });

  it('maps a KeplerianSwarm to a swarm spec carrying its color', () => {
    const swarm = swarmSpecFromGeometry('s', 'Belt', { type: 'KeplerianSwarm', color: '#ffaa00' }, 1000);
    expect(swarm?.params.color).toBe('#ffaa00');
    expect(swarm?.anchorBody).toBe('Belt');
  });

  it('maps a ParticleSystem to a particle spec with a count', () => {
    const p = particleSpecFromGeometry('p', 'Vent', { type: 'ParticleSystem', particleCount: 42 }, 10);
    expect(p?.params.count).toBe(42);
  });
});

describe('assembleSceneSpec', () => {
  it('includes a label for each body and the spacecraft, and a camera on the focus', () => {
    const spec = assembleSceneSpec({
      bodies: [{ name: 'Saturn', spiceId: 'Saturn', radiusKm: 1, color: [1, 1, 1] }],
      spacecraftName: 'Probe',
      trajectoryPoints: [[0, 0, 0]],
      trajectoryAnchor: 'Saturn',
      rings: [],
      keplerianSwarms: [],
      particleSystems: [],
      timeSwitched: [],
      cameraFocus: 'Saturn',
      cameraDistance: 5,
    });
    expect(spec.labels?.map((l) => l.id)).toEqual(['Saturn', 'Probe']);
    expect(spec.camera).toEqual({ focus: 'Saturn', azimuth: 0.6, elevation: 0.35, distance: 5 });
    expect(spec.spacecraft).toEqual({ name: 'Probe' });
  });
});

describe('buildCatalogMissionScene (orchestration with a mock SPICE)', () => {
  it('samples bodies and spacecraft, maps geometry, and reports a non-Cassini identity', async () => {
    const mission = await buildCatalogMissionScene(mockSpice(), NATIVE);
    expect(mission.identity.spacecraftName).toBe('Probe');
    expect(mission.identity.centerBody).toBe('Saturn');
    // Sun is prepended as the heliocentric origin, plus the two catalog bodies.
    expect(mission.spec.bodies.map((b) => b.name)).toEqual(['Sun', 'Saturn', 'Belt']);
    expect(mission.spec.rings).toHaveLength(1);
    expect(mission.spec.keplerianSwarms).toHaveLength(1);
    expect(mission.spec.trajectory?.points.length).toBeGreaterThan(0);
    expect(mission.table.byBody.has('Probe')).toBe(true);
  });

  it('populates bodyFrames from each body that declares a Spice orientation frame', async () => {
    const framed: BesselCatalog = {
      version: '1.0',
      bodies: [
        { id: '699', name: 'Saturn', orientation: { type: 'Spice', frame: 'IAU_SATURN' } },
        { id: '606', name: 'Titan', orientation: { type: 'Spice', frame: 'CASSINI_TITAN' } },
        // No orientation: must be absent from the map (IAU fallback covers it instead).
        { id: 'belt', name: 'Belt', geometry: { type: 'KeplerianSwarm', color: '#fa0' } },
      ],
      spacecraft: [
        {
          id: 'Probe',
          name: 'Probe',
          trajectory: { type: 'Spice', center: 'Saturn' },
          arcs: [{ timeRange: { start: '2000-01-01', stop: '2010-01-01' }, trajectory: { type: 'Spice' } }],
        },
      ],
    };
    const mission = await buildCatalogMissionScene(mockSpice(), framed);
    expect(mission.bodyFrames.get('Titan')).toBe('CASSINI_TITAN');
    expect(mission.bodyFrames.get('606')).toBe('CASSINI_TITAN');
    expect(mission.bodyFrames.get('Saturn')).toBe('IAU_SATURN');
    expect(mission.bodyFrames.has('Belt')).toBe(false);
  });

  it('resolves every catalog instrument, with the first as the active one', async () => {
    const withInstruments: BesselCatalog = {
      version: '1.0',
      bodies: [{ id: 'Saturn', name: 'Saturn' }],
      spacecraft: [
        {
          id: 'Probe',
          name: 'Probe',
          trajectory: { type: 'Spice', center: 'Saturn' },
          arcs: [{ timeRange: { start: '2000-01-01', stop: '2010-01-01' }, trajectory: { type: 'Spice' } }],
        },
      ],
      instruments: [
        { id: 'WAC', parent: 'Probe', sensor: '-82361', targets: ['Saturn'] },
        { id: 'NAC', parent: 'Probe', sensor: '-82360', targets: ['Saturn'] },
        // Malformed: a non-numeric sensor is skipped, not resolved.
        { id: 'BAD', parent: 'Probe', sensor: 'nope', targets: ['Saturn'] },
      ],
    };
    const mission = await buildCatalogMissionScene(mockSpice(), withInstruments);
    expect(mission.instruments.map((i) => i.name)).toEqual(['WAC', 'NAC']);
    expect(mission.instruments[0]?.sensorId).toBe(-82361);
    expect(mission.instrument?.name).toBe('WAC');
  });

  it('fails loudly when two instruments share an id (would make one unreachable)', async () => {
    const dupes: BesselCatalog = {
      version: '1.0',
      bodies: [{ id: 'Saturn', name: 'Saturn' }],
      spacecraft: [
        {
          id: 'Probe',
          name: 'Probe',
          trajectory: { type: 'Spice', center: 'Saturn' },
          arcs: [{ timeRange: { start: '2000-01-01', stop: '2010-01-01' }, trajectory: { type: 'Spice' } }],
        },
      ],
      instruments: [
        { id: 'CAM', parent: 'Probe', sensor: '-82361', targets: ['Saturn'] },
        { id: 'CAM', parent: 'Probe', sensor: '-82360', targets: ['Saturn'] },
      ],
    };
    await expect(buildCatalogMissionScene(mockSpice(), dupes)).rejects.toThrow(/declared more than once/);
  });

  it('resolves a UniformRotation orientation into a uniform attitude spec', async () => {
    const spun: BesselCatalog = {
      version: '1.0',
      bodies: [{ id: 'Saturn', name: 'Saturn' }],
      spacecraft: [
        {
          id: 'Probe',
          name: 'Probe',
          orientation: { type: 'UniformRotation', axis: [0, 1, 0], ratePerSec: 0.05 },
          arcs: [
            { timeRange: { start: '2000-01-01', stop: '2010-01-01' }, trajectory: { type: 'Spice' } },
          ],
        },
      ],
    };
    const mission = await buildCatalogMissionScene(mockSpice(), spun);
    expect(mission.identity.attitude).toMatchObject({ kind: 'uniform', ratePerSec: 0.05 });
  });

  it('fails loudly when the first spacecraft has no time window', async () => {
    const noWindow: BesselCatalog = {
      version: '1.0',
      spacecraft: [{ id: 'P', trajectory: { type: 'Spice', center: 'Sun' } }],
    };
    await expect(buildCatalogMissionScene(mockSpice(), noWindow)).rejects.toThrow(/time window/);
  });
});
