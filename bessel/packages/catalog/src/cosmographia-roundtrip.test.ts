// Cosmographia round-trip proof (Section 16 export design, Phase E). Three guarantees:
//  1. Fixture fidelity: canonicalize(toCosmographia(fromCosmographia(fixture)))
//     deep-equals canonicalize(fixture) on the lossless subset.
//  2. Native identity (property + table): fromCosmographia(toCosmographia(x)) === x
//     for native catalogs x over the lossless grammar.
//  3. Loud loss: a construct outside the lossless subset raises a CatalogWarning,
//     never a silent drop.
//
// canonicalize() normalizes ONLY the documented, content-preserving asymmetries the
// importer introduces (type-name aliases, Keplerian long names, sensor parent
// name->id resolution, and the Cosmographia `class` specificity that the native
// body/spacecraft split does not carry, plus synthesized sensor file/item names).
// Everything else must match byte-for-byte, so over-canonicalization cannot hide
// real loss.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CatalogWarning, fromCosmographia, toCosmographia } from './index.ts';
import type { BesselCatalog } from './native-types.ts';

const multi = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test/fixtures/cosmographia-multi.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

const TRAJECTORY_TYPE_ALIASES: Record<string, string> = {
  InterpolatedStates: 'Sampled',
  FixedPoint: 'Fixed',
  TLE: 'Tle',
  TwoBody: 'Keplerian',
  RingSystem: 'Rings',
};

const KEPLERIAN_NAME_ALIASES: Record<string, string> = {
  semiMajorAxis: 'a',
  sma: 'a',
  eccentricity: 'e',
  ecc: 'e',
  inclination: 'i',
  inc: 'i',
  ascendingNode: 'raan',
  longitudeOfAscendingNode: 'raan',
  argumentOfPeriapsis: 'argp',
  periapsisArgument: 'argp',
  meanAnomaly: 'm0',
  meanAnomalyAtEpoch: 'm0',
};

// Keys that carry Cosmographia-only specificity the native model does not preserve.
// `class` is the body/spacecraft *kind* (planet/moon/comet): native keeps the
// body-vs-spacecraft split but not the specific class string.
const DROP_KEYS = new Set(['class']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Build a display-name -> id index across the items so sensor `parent` references
 *  given by name (Cosmographia) and by id (Bessel export) canonicalize identically. */
function nameToIdIndex(items: readonly unknown[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = typeof item['id'] === 'string' ? item['id'] : undefined;
    const name = typeof item['name'] === 'string' ? item['name'] : undefined;
    const cls = typeof item['class'] === 'string' ? item['class'].toLowerCase() : undefined;
    if (cls === 'sensor' || cls === 'observation') continue;
    if (id !== undefined && name !== undefined) index.set(name, id);
  }
  return index;
}

function canonicalizeValue(value: unknown, parents: Map<string, string>, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalizeValue(v, parents, key));
  if (!isRecord(value)) {
    if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    if (DROP_KEYS.has(k)) continue;
    let v = value[k];

    if (k === 'type' && typeof v === 'string' && TRAJECTORY_TYPE_ALIASES[v] !== undefined) {
      v = TRAJECTORY_TYPE_ALIASES[v];
    }

    // Resolve a sensor `parent` reference (name or id) to its id.
    if (k === 'parent' && typeof v === 'string') {
      v = parents.get(v) ?? v;
    }

    // Keplerian element blocks: rename long names to the native short names.
    if (k === 'elements' && isRecord(v)) {
      const renamed: Record<string, unknown> = {};
      for (const [ek, ev] of Object.entries(v)) {
        renamed[KEPLERIAN_NAME_ALIASES[ek] ?? ek] = ev;
      }
      v = renamed;
    }

    out[k] = canonicalizeValue(v, parents, k);
  }
  return out;
}

/** Canonicalize a Cosmographia catalog: sort keys, normalize type/element/parent
 *  aliases, drop class specificity, and sort the items array by a stable key so the
 *  re-expanded sensor order does not matter. */
function canonicalize(catalog: unknown): unknown {
  if (!isRecord(catalog)) return canonicalizeValue(catalog, new Map());
  const rawItems = Array.isArray(catalog['items']) ? (catalog['items'] as unknown[]) : [];
  const parents = nameToIdIndex(rawItems);

  const items = rawItems
    .map((item) => canonicalizeValue(item, parents) as Record<string, unknown>)
    .sort((a, b) => itemKey(a).localeCompare(itemKey(b)));

  const top = canonicalizeValue(catalog, parents) as Record<string, unknown>;
  top['items'] = items;
  return top;
}

/** A stable sort key for an item: kind + id/name + (for sensors) target. */
function itemKey(item: Record<string, unknown>): string {
  const id = String(item['id'] ?? item['name'] ?? '');
  const instrument = String(item['instrument'] ?? '');
  const target = String(item['target'] ?? '');
  return `${id}|${instrument}|${target}`;
}

// ---------------------------------------------------------------------------
// 1. Fixture fidelity
// ---------------------------------------------------------------------------

describe('toCosmographia (fixture round-trip)', () => {
  it('canonicalize(export(import(fixture))) deep-equals canonicalize(fixture)', async () => {
    const native = await fromCosmographia(multi);
    const { catalog } = toCosmographia(native);
    expect(canonicalize(catalog)).toEqual(canonicalize(multi));
  });

  it('re-imports the exported catalog to the identical native catalog (cosmo->native->cosmo->native)', async () => {
    const native = await fromCosmographia(multi);
    const { catalog } = toCosmographia(native);
    const reimported = await fromCosmographia(catalog);
    expect(reimported).toEqual(native);
  });

  it('preserves the nested Globe ring system across the round-trip', async () => {
    const native = await fromCosmographia(multi);
    const { catalog } = toCosmographia(native);
    const saturn = catalog.items.find((i) => (i as { name?: string }).name === 'Saturn') as Record<string, unknown>;
    const geometry = saturn['geometry'] as Record<string, unknown>;
    expect(geometry['rings']).toMatchObject({ type: 'Rings', innerRadius: 74500, outerRadius: 140220 });
  });

  it('re-expands the collapsed instrument into one sensor item per target', async () => {
    const native = await fromCosmographia(multi);
    const { catalog } = toCosmographia(native);
    const sensors = catalog.items.filter((i) => (i as { class?: string }).class === 'sensor');
    expect(sensors).toHaveLength(2);
    expect(sensors.map((s) => (s as { target?: string }).target).sort()).toEqual(['Landmark', 'Titan']);
  });
});

// ---------------------------------------------------------------------------
// 2. Native identity (property + table)
// ---------------------------------------------------------------------------

/** A small generator over the lossless native grammar: one body + one spacecraft,
 *  each over the five trajectory forms and four orientation forms. */
const arbCatalog = (): fc.Arbitrary<BesselCatalog> => {
  const id = fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^[A-Za-z0-9_-]+$/.test(s));
  const angle = fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true });
  const km = fc.double({ min: 100, max: 1e6, noNaN: true, noDefaultInfinity: true });

  const trajectory = fc.oneof(
    fc.record({ type: fc.constant('Spice' as const), target: id, center: id, frame: fc.constant('J2000') }),
    fc.record({
      type: fc.constant('Keplerian' as const),
      elements: fc.record({
        a: km,
        e: fc.double({ min: 0, max: 0.9, noNaN: true, noDefaultInfinity: true }),
        i: angle,
        raan: angle,
        argp: angle,
        m0: angle,
        epoch: fc.constant('2004-06-22T00:00:00Z'),
      }),
      center: id,
    }),
    fc.record({
      type: fc.constant('Tle' as const),
      line1: fc.constant('1 25544U 98067A   04174.00000000  .00000000  00000-0  00000-0 0  9990'),
      line2: fc.constant('2 25544  51.6000 000.0000 0001000 000.0000 000.0000 15.50000000000000'),
      center: fc.constant('399'),
    }),
    fc.record({
      type: fc.constant('Fixed' as const),
      position: fc.tuple(km, km, km) as fc.Arbitrary<[number, number, number]>,
      center: id,
    }),
    fc.record({ type: fc.constant('Sampled' as const), source: fc.constant('states/x.xyz'), center: id }),
  );

  const orientation = fc.oneof(
    fc.record({ type: fc.constant('Spice' as const), frame: fc.constant('IAU_X') }),
    fc.record({
      type: fc.constant('Fixed' as const),
      quaternion: fc.constant([0, 0, 0, 1] as [number, number, number, number]),
    }),
    fc.record({
      type: fc.constant('UniformRotation' as const),
      axis: fc.constant([0, 0, 1] as [number, number, number]),
      ratePerSec: fc.double({ min: 0.001, max: 1, noNaN: true, noDefaultInfinity: true }),
    }),
    fc.record({
      type: fc.constant('TwoVector' as const),
      primary: fc.record({ axis: fc.constant('z' as const), target: id }),
      secondary: fc.record({
        axis: fc.constant([1, 0, 0] as [number, number, number]),
        target: fc.constant('Sun'),
      }),
    }),
  );

  return fc
    .tuple(id, id, trajectory, orientation)
    .filter(([bodyId, scId]) => bodyId !== scId)
    .map(
      ([bodyId, scId, traj, orient]): BesselCatalog => ({
        version: '1.0',
        name: 'Generated',
        bodies: [{ id: bodyId, name: bodyId, orientation: orient }],
        spacecraft: [{ id: scId, name: scId, trajectory: traj }],
      }),
    );
};

describe('fromCosmographia(toCosmographia(x)) is identity over the lossless grammar', () => {
  it('property: a generated native catalog survives native->cosmo->native unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(arbCatalog(), async (x) => {
        const { catalog } = toCosmographia(x);
        const back = await fromCosmographia(catalog);
        expect(back).toEqual(x);
      }),
      { numRuns: 60 },
    );
  });

  it('table: a fixed set of catalogs over the grammar round-trips to identity', async () => {
    const table: BesselCatalog[] = [
      {
        version: '1.0',
        name: 'Spice + Spice rotation',
        spacecraft: [
          { id: '-82', name: '-82', trajectory: { type: 'Spice', target: '-82', center: '6', frame: 'J2000' }, orientation: { type: 'Spice', frame: 'IAU_SATURN' } },
        ],
      },
      {
        version: '1.0',
        name: 'Keplerian + UniformRotation',
        bodies: [
          {
            id: '606',
            name: 'Titan',
            trajectory: {
              type: 'Keplerian',
              elements: { a: 1221870, e: 0.0288, i: 0.0048, raan: 0.4, argp: 0.3, m0: 1.2, epoch: '2004-06-22T00:00:00Z' },
              center: '6',
            },
            orientation: { type: 'UniformRotation', axis: [0, 0, 1], ratePerSec: 0.05 },
          },
        ],
      },
      {
        version: '1.0',
        name: 'Fixed trajectory + Fixed rotation + Globe rings',
        bodies: [
          {
            id: '6',
            name: 'Saturn',
            geometry: { type: 'Globe', radii: [60268, 60268, 54364], texture: 't.jpg', rings: { type: 'Rings', innerRadius: 74500, outerRadius: 140220 } },
            orientation: { type: 'Fixed', quaternion: [0, 0, 0, 1] },
          },
          { id: 'LM', name: 'Landmark', trajectory: { type: 'Fixed', position: [1, 2, 3], center: '6' } },
        ],
      },
      {
        version: '1.0',
        name: 'Sampled + KeplerianSwarm + instrument + observation',
        spacecraft: [{ id: 'S', name: 'S', trajectory: { type: 'Sampled', source: 's.xyz', format: 'xyz', center: '6' } }],
        bodies: [{ id: 'B', name: 'B', geometry: { type: 'KeplerianSwarm', source: 'k.json', color: '#88aaff' } }],
        instruments: [{ id: 'Cam', parent: 'S', sensor: 'CAM', targets: ['B'] }],
        observations: [{ instrument: 'Cam', target: 'B', intervals: [{ start: '2004-07-01T00:00:00Z', stop: '2004-07-01T01:00:00Z' }], footprintColor: '#ff33cc' }],
      },
    ];

    for (const x of table) {
      const { catalog } = toCosmographia(x);
      const back = await fromCosmographia(catalog);
      expect(back).toEqual(x);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Loud loss (CatalogWarning)
// ---------------------------------------------------------------------------

describe('toCosmographia warns loudly on lossy constructs (never a silent drop)', () => {
  it('emits a CatalogWarning when a collapsed instrument re-expands to multiple sensor files', async () => {
    const native = await fromCosmographia(multi);
    const { warnings } = toCosmographia(native);
    const expansion = warnings.find((w) => w.location.startsWith('$.instruments'));
    expect(expansion).toBeInstanceOf(CatalogWarning);
    expect(expansion?.message).toMatch(/synthesized/);
  });

  it('emits a CatalogWarning for a multi-arc spacecraft (single Cosmographia item cannot carry it)', () => {
    const catalog: BesselCatalog = {
      version: '1.0',
      name: 'Multi-arc',
      spacecraft: [
        {
          id: 'X',
          name: 'X',
          arcs: [
            { timeRange: { start: '2004-01-01T00:00:00Z', stop: '2004-01-02T00:00:00Z' }, trajectory: { type: 'Spice', target: 'X', center: '6' } },
            { timeRange: { start: '2004-01-02T00:00:00Z', stop: '2004-01-03T00:00:00Z' }, trajectory: { type: 'Spice', target: 'X', center: '6' } },
          ],
        },
      ],
    };
    const { warnings } = toCosmographia(catalog);
    const arcWarn = warnings.find((w) => w.location.endsWith('.arcs'));
    expect(arcWarn).toBeInstanceOf(CatalogWarning);
    expect(arcWarn?.message).toMatch(/arcs/);
  });

  it('emits a CatalogWarning for kernels.metaKernels that the flat spiceKernels array cannot express', () => {
    const catalog: BesselCatalog = {
      version: '1.0',
      name: 'Meta',
      kernels: { paths: ['a.bsp'], metaKernels: ['mission.tm'] },
      bodies: [{ id: 'B', name: 'B' }],
    };
    const { warnings } = toCosmographia(catalog);
    const kernelWarn = warnings.find((w) => w.location === '$.kernels');
    expect(kernelWarn).toBeInstanceOf(CatalogWarning);
  });
});
