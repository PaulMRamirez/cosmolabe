import { describe, it, expect } from 'vitest';
import {
  StarCatalogError,
  buildStarPoints,
  magnitudeToSize,
  parseStarCatalog,
  radec2vec,
  type Star,
} from './index.ts';

describe('@bessel/scene star catalog', () => {
  it('converts RA/Dec to unit vectors', () => {
    // RA 0, Dec 0 points along +X.
    expect(radec2vec(0, 0)).toEqual([1, 0, 0]);
    // RA 90, Dec 0 points along +Y.
    const y = radec2vec(90, 0);
    expect(y[0]).toBeCloseTo(0, 6);
    expect(y[1]).toBeCloseTo(1, 6);
    // Dec 90 points along +Z.
    expect(radec2vec(0, 90)[2]).toBeCloseTo(1, 6);
    // All are unit length.
    const v = radec2vec(123.4, -42.1);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  it('parses a catalog and rejects malformed rows with a located error', () => {
    const stars = parseStarCatalog([
      { ra: 101.3, dec: -16.7, mag: -1.46 },
      { ra: 95.99, dec: -52.7, mag: -0.74 },
    ]);
    expect(stars).toHaveLength(2);
    try {
      parseStarCatalog([{ ra: 1, dec: 2 }]);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StarCatalogError);
      expect((err as StarCatalogError).location).toBe('$[0].mag');
    }
  });

  it('builds star points on the celestial sphere sized by magnitude', () => {
    const stars: Star[] = [
      { ra: 0, dec: 0, mag: -1.5 },
      { ra: 90, dec: 0, mag: 5 },
    ];
    const { positions, sizes } = buildStarPoints(stars);
    expect(positions.length).toBe(6);
    // Brighter star (lower mag) is larger.
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(magnitudeToSize(-1.5)).toBeGreaterThan(magnitudeToSize(5));
  });
});
