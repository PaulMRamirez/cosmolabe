import { describe, expect, it } from 'vitest';
import { buildSwarmPositions, type KeplerianSwarmParams } from './keplerian-swarm.ts';
import { SCALE } from './geometry-builders.ts';

const params: KeplerianSwarmParams = {
  count: 300,
  semiMajorMinKm: 180000,
  semiMajorMaxKm: 480000,
  eccentricity: 0.05,
  inclinationDeg: 2,
  color: '#bcd4ff',
};

describe('buildSwarmPositions', () => {
  it('emits count points with finite coordinates', () => {
    const pos = buildSwarmPositions(params);
    expect(pos).toHaveLength(params.count * 3);
    expect([...pos].every((v) => Number.isFinite(v))).toBe(true);
  });

  it('keeps radii within the periapsis/apoapsis envelope', () => {
    const pos = buildSwarmPositions(params);
    const rMin = params.semiMajorMinKm * (1 - params.eccentricity) * SCALE * 0.99;
    const rMax = params.semiMajorMaxKm * (1 + params.eccentricity) * SCALE * 1.01;
    for (let i = 0; i < params.count; i++) {
      const r = Math.hypot(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      expect(r).toBeGreaterThanOrEqual(rMin);
      expect(r).toBeLessThanOrEqual(rMax);
    }
  });

  it('confines the out-of-plane spread to the inclination bound', () => {
    const pos = buildSwarmPositions(params);
    const rMax = params.semiMajorMaxKm * (1 + params.eccentricity) * SCALE;
    const zBound = rMax * Math.sin((params.inclinationDeg * Math.PI) / 180) * 1.05;
    for (let i = 0; i < params.count; i++) {
      expect(Math.abs(pos[i * 3 + 2]!)).toBeLessThanOrEqual(zBound);
    }
  });

  it('is deterministic across calls', () => {
    expect([...buildSwarmPositions(params)]).toEqual([...buildSwarmPositions(params)]);
  });
});
