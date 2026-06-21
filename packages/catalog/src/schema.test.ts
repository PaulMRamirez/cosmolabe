import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CatalogError, parseBesselCatalog, schemaIsValid, validateCatalog } from './index.ts';

const example = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../schema/examples/cassini-saturn.example.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('@bessel/catalog native schema', () => {
  it('passes Draft 2020-12 meta-validation', async () => {
    expect(await schemaIsValid()).toBe(true);
  });

  it('validates the Cassini-style reference example cleanly', async () => {
    const result = await validateCatalog(example);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects a spacecraft that declares both arcs and a trajectory', async () => {
    const bad = clone(example);
    const sc = (bad['spacecraft'] as Record<string, unknown>[])[0]!;
    sc['trajectory'] = { type: 'Spice', center: 'SSB', frame: 'ECLIPJ2000' };
    // it still has "arcs" from the example, so the oneOf must fail.
    expect((await validateCatalog(bad)).valid).toBe(false);
  });

  it('rejects sideDivisions below the floor of 2 (the Cosmographia crash case)', async () => {
    const bad = clone(example);
    const inst = (bad['instruments'] as Record<string, unknown>[])[0]!;
    const styles = (inst['fov'] as { styles: Record<string, Record<string, unknown>> }).styles;
    styles['default']!['sideDivisions'] = 1;
    expect((await validateCatalog(bad)).valid).toBe(false);
  });

  it('parseBesselCatalog throws a located CatalogError for an invalid catalog', async () => {
    try {
      await parseBesselCatalog({ version: '1.0', spacecraft: [{ id: 'X', trajectory: {}, arcs: [] }] });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogError);
      expect(typeof (err as CatalogError).location).toBe('string');
    }
  });

  it('throws a located error for a broken instrument parent reference', async () => {
    const bad = clone(example);
    (bad['instruments'] as Record<string, unknown>[])[0]!['parent'] = 'NO_SUCH_CRAFT';
    try {
      await parseBesselCatalog(bad);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogError);
      expect((err as CatalogError).location).toBe('$.instruments[0].parent');
    }
  });
});
