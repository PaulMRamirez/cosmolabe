import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CatalogError, parseCosmographiaCatalog } from './index.ts';

const example = JSON.parse(
  readFileSync(fileURLToPath(new URL('../examples/cassini-cosmographia.json', import.meta.url)), 'utf8'),
) as unknown;

describe('@bessel/catalog Cosmographia parser', () => {
  it('parses the Cassini spacecraft catalog into a typed trajectory spec', () => {
    const sc = parseCosmographiaCatalog(example);
    expect(sc.name).toBe('Cassini');
    expect(sc.spiceId).toBe('-82');
    expect(sc.center).toBe('6');
    expect(sc.frame).toBe('J2000');
    expect(sc.kernels).toContain('cassini-soi.bsp');
    expect(sc.startTime).toBe('2004-06-22T00:00:00');
  });

  it('throws a located CatalogError for an unsupported trajectory type', () => {
    const bad = {
      name: 'broken',
      items: [{ class: 'spacecraft', name: 'x', trajectory: { type: 'TwoBody', target: 'x', center: 'y' } }],
    };
    try {
      parseCosmographiaCatalog(bad);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogError);
      expect((err as CatalogError).location).toBe('$.items[0].trajectory.type');
    }
  });

  it('throws when no spacecraft item is present', () => {
    expect(() => parseCosmographiaCatalog({ name: 'empty', items: [{ name: 'x' }] })).toThrow(
      CatalogError,
    );
  });
});
