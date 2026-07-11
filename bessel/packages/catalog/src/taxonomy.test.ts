import { describe, it, expect } from 'vitest';
import { GEOMETRY_TYPES, validateCatalog, type Geometry } from './index.ts';

// A minimal valid geometry instance for each of the seven taxonomy types.
const SAMPLES: Record<string, Geometry> = {
  Mesh: { type: 'Mesh', source: 'cassini.glb', scale: 0.001 },
  DSK: { type: 'DSK', source: 'phoebe.bds' },
  Globe: { type: 'Globe', radii: [60268, 60268, 54364], texture: 'saturn.jpg' },
  Rings: { type: 'Rings', innerRadius: 74500, outerRadius: 140220 },
  ParticleSystem: { type: 'ParticleSystem', source: 'enceladus_plume.json', particleCount: 5000 },
  KeplerianSwarm: { type: 'KeplerianSwarm', source: 'main_belt.json', color: '#888888' },
  TimeSwitched: {
    type: 'TimeSwitched',
    segments: [
      {
        timeRange: { start: '2004-01-01T00:00:00Z', stop: '2005-01-01T00:00:00Z' },
        geometry: { type: 'Globe', radii: [1, 1, 1] },
      },
    ],
  },
};

describe('@bessel/catalog geometry taxonomy', () => {
  it('declares exactly the seven Cosmographia geometry types', () => {
    expect([...GEOMETRY_TYPES].sort()).toEqual(
      ['DSK', 'Globe', 'KeplerianSwarm', 'Mesh', 'ParticleSystem', 'Rings', 'TimeSwitched'].sort(),
    );
  });

  for (const type of GEOMETRY_TYPES) {
    it(`validates a body carrying ${type} geometry`, async () => {
      const catalog = {
        version: '1.0',
        bodies: [{ id: 'B1', geometry: SAMPLES[type] }],
      };
      const result = await validateCatalog(catalog);
      expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    });
  }
});
