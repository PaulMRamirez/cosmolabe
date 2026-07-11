// Job validation is the loud gate: a well-formed job passes through unchanged, and each
// malformed shape throws a located JobSchemaError (or the version error) with the exact
// JSON pointer. (STK_PARITY_SPEC, SDK.)

import { describe, it, expect } from 'vitest';
import { validateJob } from './validate.ts';
import { JobSchemaError, UnsupportedJobVersionError } from '../errors.ts';
import type { BatchJob } from './types.ts';

const VALID: BatchJob = {
  besselBatch: '1',
  entities: { SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-01-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.5, 0] } } },
  operations: [
    { op: 'furnish', names: ['naif0012.tls'] },
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-01-01T00:00:00', stop: '2025-01-01T01:00:00', stepSec: 600 } },
    { op: 'exportOem', from: 'eph', file: 'eph.oem' },
  ],
  output: { dir: 'out' },
};

describe('validateJob', () => {
  it('passes a well-formed job through unchanged', () => {
    expect(validateJob(VALID)).toEqual(VALID);
  });

  const cases: [string, unknown, string][] = [
    ['missing besselBatch', { ...VALID, besselBatch: undefined }, '/besselBatch'],
    ['empty operations', { ...VALID, operations: [] }, '/operations'],
    ['unknown op', { ...VALID, operations: [{ op: 'frobnicate' }] }, '/operations/0/op'],
    ['bad grid stepSec', { ...VALID, operations: [{ op: 'propagate', id: 'e', object: 'SAT', method: 'twobody', grid: { start: 'a', stop: 'b', stepSec: 0 } }] }, '/operations/0/grid/stepSec'],
    ['unknown propagate method', { ...VALID, operations: [{ op: 'propagate', id: 'e', object: 'SAT', method: 'rk4', grid: { epochs: ['a'] } }] }, '/operations/0/method'],
    ['missing output dir', { ...VALID, output: {} }, '/output/dir'],
    ['bad satellite source kind', { ...VALID, entities: { SAT: { type: 'satellite', source: { kind: 'magic' } } } }, '/entities/SAT/source/kind'],
    ['eclipse missing body', { ...VALID, operations: [{ op: 'analyzeEclipse', id: 'e', observer: 'x', grid: { epochs: ['a', 'b'] } }] }, '/operations/0/body'],
    ['bad eclipse condition', { ...VALID, operations: [{ op: 'analyzeEclipse', id: 'e', observer: 'x', body: 'EARTH', grid: { epochs: ['a', 'b'] }, condition: 'dusk' }] }, '/operations/0/condition'],
    ['access bad facility latitude', { ...VALID, operations: [{ op: 'analyzeAccess', id: 'a', observer: 'x', target: 'y', grid: { epochs: ['a', 'b'] }, facility: { body: 'EARTH', bodyFrame: 'IAU_EARTH', lonDeg: 0, latDeg: 'north', altKm: 0, minElevationDeg: 10 } }] }, '/operations/0/facility/latDeg'],
    ['link budget missing radio', { ...VALID, operations: [{ op: 'analyzeLinkBudget', id: 'l', observer: 'x', target: 'y', grid: { epochs: ['a', 'b'] } }] }, '/operations/0/radio'],
    ['link budget bad freq', { ...VALID, operations: [{ op: 'analyzeLinkBudget', id: 'l', observer: 'x', target: 'y', grid: { epochs: ['a', 'b'] }, radio: { eirpDbW: 1, freqHz: 'x', gOverTDbK: 1, dataRateBps: 1 } }] }, '/operations/0/radio/freqHz'],
    ['loadCatalog missing file', { ...VALID, operations: [{ op: 'loadCatalog' }] }, '/operations/0/file'],
    ['report from not an array', { ...VALID, operations: [{ op: 'report', from: 'eph', file: 'r.json' }] }, '/operations/0/from'],
  ];
  for (const [label, job, pointer] of cases) {
    it(`rejects: ${label} (pointer ${pointer})`, () => {
      try {
        validateJob(job);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(JobSchemaError);
        expect((e as JobSchemaError).pointer).toBe(pointer);
      }
    });
  }

  it('rejects an unsupported version with the seen value', () => {
    try {
      validateJob({ ...VALID, besselBatch: '2' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedJobVersionError);
      expect((e as UnsupportedJobVersionError).seen).toBe('2');
    }
  });
});
