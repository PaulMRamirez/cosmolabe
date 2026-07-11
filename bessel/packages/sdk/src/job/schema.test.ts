// The shipped JSON Schema (schema.json, Draft 2020-12) and the hand-written validator
// must agree on what a batch job is. The hand validator stays the runtime source of
// truth; this test asserts the schema accepts a canonical valid job and rejects
// representative mutations (and that the hand validator rejects the same mutations).
// (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { validateJob } from './validate.ts';
import type { BatchJob } from './types.ts';

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('./schema.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// A canonical valid job exercising every operation kind the schema knows.
const VALID: BatchJob = {
  besselBatch: '1',
  meta: { name: 'canonical', description: 'every op kind' },
  defaults: { frame: 'J2000', center: 'EARTH' },
  entities: {
    SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-03-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.5, 0] } },
  },
  operations: [
    { op: 'furnish', names: ['naif0012.tls'] },
    { op: 'loadCatalog', file: 'mission.json' },
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 300 }, publishAs: { naifId: -999100 } },
    { op: 'runMcs', id: 'mcs', mcs: { version: 1, root: { kind: 'Sequence', id: 'r', children: [] } } },
    { op: 'analyze', id: 'rng', kind: 'range', observer: '399', target: '-999100', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 300 } },
    { op: 'analyzeEclipse', id: 'ecl', observer: '-999100', body: 'EARTH', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 120 }, condition: 'umbra' },
    { op: 'analyzeAccess', id: 'acc', observer: '-999100', target: 'SUN', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 120 }, facility: { body: 'EARTH', bodyFrame: 'IAU_EARTH', lonDeg: -116.89, latDeg: 35.43, altKm: 1, minElevationDeg: 10 } },
    { op: 'analyzeLinkBudget', id: 'link', observer: '-999100', target: 'EARTH', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 120 }, radio: { eirpDbW: 90, freqHz: 8.4e9, gOverTDbK: 53, dataRateBps: 14000 } },
    { op: 'report', from: ['ecl', 'acc'], file: 'report.json' },
    { op: 'exportCsv', from: 'rng', file: 'rng.csv' },
    { op: 'exportOem', from: 'eph', file: 'eph.oem' },
  ],
  output: { dir: 'out', onError: 'continue' },
};

// Each mutation turns the valid job into an invalid one a single, located way.
const MUTATIONS: { readonly name: string; mutate(j: BatchJob): unknown }[] = [
  { name: 'wrong version', mutate: (j) => ({ ...j, besselBatch: '2' }) },
  { name: 'missing operations', mutate: (j) => ({ ...j, operations: undefined }) },
  { name: 'empty operations', mutate: (j) => ({ ...j, operations: [] }) },
  { name: 'missing output dir', mutate: (j) => ({ ...j, output: {} }) },
  { name: 'unknown op', mutate: (j) => ({ ...j, operations: [{ op: 'teleport' }] }) },
  { name: 'bad propagate method', mutate: (j) => ({ ...j, operations: [{ op: 'propagate', id: 'p', object: 'SAT', method: 'rk89', grid: { start: 'a', stop: 'b', stepSec: 1 } }] }) },
  { name: 'bad eclipse condition', mutate: (j) => ({ ...j, operations: [{ op: 'analyzeEclipse', id: 'e', observer: 'x', body: 'EARTH', grid: { epochs: ['a', 'b'] }, condition: 'twilight' }] }) },
  { name: 'link budget missing radio', mutate: (j) => ({ ...j, operations: [{ op: 'analyzeLinkBudget', id: 'l', observer: 'x', target: 'EARTH', grid: { epochs: ['a', 'b'] } }] }) },
  { name: 'report from not an array', mutate: (j) => ({ ...j, operations: [{ op: 'report', from: 'ecl', file: 'r.json' }] }) },
  { name: 'non-positive step', mutate: (j) => ({ ...j, operations: [{ op: 'analyze', id: 'a', kind: 'range', observer: 'x', target: 'y', grid: { start: 'a', stop: 'b', stepSec: 0 } }] }) },
];

describe('schema.json (Draft 2020-12) and the hand validator agree', () => {
  it('compiles as a valid Draft 2020-12 schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it('accepts the canonical valid job (schema and hand validator)', () => {
    expect(validate(VALID)).toBe(true);
    expect(() => validateJob(VALID)).not.toThrow();
  });

  for (const m of MUTATIONS) {
    it(`rejects: ${m.name}`, () => {
      const bad = m.mutate(structuredClone(VALID));
      expect(validate(bad)).toBe(false);
      expect(() => validateJob(bad)).toThrow();
    });
  }
});
