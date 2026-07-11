import { describe, expect, it } from 'vitest';
import { buildParticlePositions, type ParticleSystemParams } from './particle-system.ts';
import { SCALE } from './geometry-builders.ts';

const params: ParticleSystemParams = {
  count: 200,
  direction: [0, 1, 0],
  spreadDeg: 20,
  lengthKm: 10000,
  baseRadiusKm: 500,
  color: '#ffffff',
};

describe('buildParticlePositions', () => {
  it('emits count points with finite coordinates', () => {
    const pos = buildParticlePositions(params);
    expect(pos).toHaveLength(params.count * 3);
    expect([...pos].every((v) => Number.isFinite(v))).toBe(true);
  });

  it('keeps particles within the cone length plus lateral spread', () => {
    const pos = buildParticlePositions(params);
    const maxAlong = (params.baseRadiusKm + params.lengthKm) * SCALE;
    // Lateral spread is bounded by tan(spread) * along; allow generous margin.
    const bound = maxAlong * (1 + Math.tan((params.spreadDeg * Math.PI) / 180)) * 1.2;
    for (let i = 0; i < params.count; i++) {
      const r = Math.hypot(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      expect(r).toBeLessThanOrEqual(bound);
    }
  });

  it('is deterministic across calls', () => {
    expect([...buildParticlePositions(params)]).toEqual([...buildParticlePositions(params)]);
  });
});
