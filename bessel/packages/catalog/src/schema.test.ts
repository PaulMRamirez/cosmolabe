import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CatalogError, parseBesselCatalog, schemaIsValid, validateCatalog } from './index.ts';
import { ORIENTATION_TYPES, TRAJECTORY_TYPES } from './native-types.ts';

const example = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../schema/examples/cassini-saturn.example.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

interface SchemaDef {
  readonly $defs: Record<string, unknown>;
}

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../schema/bessel-catalog.schema.json', import.meta.url)),
    'utf8',
  ),
) as SchemaDef;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Collect the trajectory `type` consts the schema oneOf branches declare. */
function schemaTrajectoryTypes(): string[] {
  const traj = schema.$defs['trajectory'] as { oneOf: { $ref: string }[] };
  return traj.oneOf.map((branch) => {
    const ref = branch.$ref.replace('#/$defs/', '');
    const def = schema.$defs[ref] as { properties: { type: { const: string } } };
    return def.properties.type.const;
  });
}

/** The orientation `type` enum the schema declares. */
function schemaOrientationTypes(): string[] {
  const ori = schema.$defs['orientation'] as { properties: { type: { enum: string[] } } };
  return ori.properties.type.enum;
}

/** A minimal valid catalog wrapping a single spacecraft trajectory. */
function spacecraftWithTrajectory(trajectory: unknown): Record<string, unknown> {
  return {
    version: '1.0',
    spacecraft: [{ id: 'SAT', trajectory }],
  };
}

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

describe('@bessel/catalog schema<->TS cross-check (C5: drift fails the gate)', () => {
  it('every TS Trajectory type has a schema branch and vice versa', () => {
    expect([...TRAJECTORY_TYPES].sort()).toEqual(schemaTrajectoryTypes().sort());
  });

  it('every TS Orientation type has a schema enum member and vice versa', () => {
    expect([...ORIENTATION_TYPES].sort()).toEqual(schemaOrientationTypes().sort());
  });
});

describe('@bessel/catalog trajectory union validation', () => {
  it('validates a Keplerian trajectory with complete elements', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Keplerian',
      elements: {
        a: 7000.0,
        e: 0.001,
        i: 0.9,
        raan: 1.2,
        argp: 0.3,
        m0: 0.0,
        epoch: '2026-01-01T00:00:00Z',
      },
      center: 'EARTH',
      frame: 'J2000',
    });
    const result = await validateCatalog(cat);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects a Keplerian trajectory missing a required element (fail loud)', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Keplerian',
      elements: {
        a: 7000.0,
        e: 0.001,
        i: 0.9,
        raan: 1.2,
        argp: 0.3,
        epoch: '2026-01-01T00:00:00Z',
      },
    });
    expect((await validateCatalog(cat)).valid).toBe(false);
  });

  it('validates a Tle trajectory with both lines', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Tle',
      line1: '1 25544U 98067A   24001.00000000  .00000000  00000-0  00000-0 0  9990',
      line2: '2 25544  51.6400 000.0000 0001000 000.0000 000.0000 15.50000000000000',
    });
    const result = await validateCatalog(cat);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects a Tle trajectory missing line2 (fail loud)', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Tle',
      line1: '1 25544U 98067A   24001.00000000  .00000000  00000-0  00000-0 0  9990',
    });
    expect((await validateCatalog(cat)).valid).toBe(false);
  });

  it('validates a Fixed trajectory with a three-vector position', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Fixed',
      position: [1000.0, 2000.0, 3000.0],
      center: 'EARTH',
    });
    const result = await validateCatalog(cat);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects a Fixed trajectory missing its position (fail loud)', async () => {
    const cat = spacecraftWithTrajectory({ type: 'Fixed', center: 'EARTH' });
    expect((await validateCatalog(cat)).valid).toBe(false);
  });

  it('validates a Sampled trajectory with a source', async () => {
    const cat = spacecraftWithTrajectory({
      type: 'Sampled',
      source: 'states/orbit.oem',
      format: 'oem',
    });
    const result = await validateCatalog(cat);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects a Sampled trajectory missing its source (fail loud)', async () => {
    const cat = spacecraftWithTrajectory({ type: 'Sampled', format: 'oem' });
    expect((await validateCatalog(cat)).valid).toBe(false);
  });

  it('validates a TwoVector orientation with primary and secondary directions', async () => {
    const cat = {
      version: '1.0',
      spacecraft: [
        {
          id: 'SAT',
          trajectory: { type: 'Spice', center: 'EARTH', frame: 'J2000' },
          orientation: {
            type: 'TwoVector',
            primary: { axis: '-z', target: 'EARTH' },
            secondary: { axis: [0, 1, 0], frame: 'J2000' },
          },
        },
      ],
    };
    const result = await validateCatalog(cat);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });
});
