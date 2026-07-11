// The programmatic builder lowers to the same IR a hand-written JSON job parses into, so
// the two authoring paths cannot drift. (STK_PARITY_SPEC, SDK.)

import { describe, it, expect } from 'vitest';
import { defineJob } from './job-builder.ts';
import { validateJob } from '../job/validate.ts';
import type { BatchJob } from '../job/types.ts';

describe('defineJob builder', () => {
  it('emits the expected BatchJob IR', () => {
    const job = defineJob({ name: 'demo' })
      .defaults({ frame: 'J2000', center: 'EARTH' })
      .satellite('SAT', { kind: 'state', epoch: '2025-01-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.5, 0] })
      .furnish(['naif0012.tls'])
      .propagate('eph', { object: 'SAT', method: 'twobody', grid: { start: '2025-01-01T00:00:00', stop: '2025-01-01T01:00:00', stepSec: 600 } })
      .exportOem({ from: 'eph', file: 'eph.oem' })
      .output({ dir: 'out' })
      .toJSON();

    const expected: BatchJob = {
      besselBatch: '1',
      meta: { name: 'demo' },
      defaults: { frame: 'J2000', center: 'EARTH' },
      entities: { SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-01-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.5, 0] } } },
      operations: [
        { op: 'furnish', names: ['naif0012.tls'] },
        { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-01-01T00:00:00', stop: '2025-01-01T01:00:00', stepSec: 600 } },
        { op: 'exportOem', from: 'eph', file: 'eph.oem' },
      ],
      output: { dir: 'out' },
    };
    expect(job).toEqual(expected);
  });

  it('toJSON validates (a bad sub-IR throws)', () => {
    const b = defineJob().furnish(['x']).output({ dir: 'out' });
    expect(() => validateJob(b.toJSON())).not.toThrow();
  });

  it('throws if output() was never called', () => {
    expect(() => defineJob().furnish(['x']).toJSON()).toThrow(/output/);
  });

  it('lowers the analysis-suite ops to the expected IR', () => {
    const grid = { start: '2004-07-01T00:00:00', stop: '2004-07-01T06:00:00', stepSec: 60 } as const;
    const job = defineJob()
      .loadCatalog({ file: 'mission.json' })
      .analyzeEclipse('ecl', { observer: '-82', body: 'SATURN', grid })
      .analyzeAccess('acc', { observer: '-82', target: 'SUN', losBody: 'SATURN', grid })
      .analyzeLinkBudget('link', { observer: '-82', target: 'EARTH', grid, radio: { eirpDbW: 90, freqHz: 8.4e9, gOverTDbK: 53, dataRateBps: 14000 } })
      .report({ from: ['ecl', 'acc'], file: 'report.json' })
      .output({ dir: 'out' })
      .toJSON();

    expect(job.operations).toEqual([
      { op: 'loadCatalog', file: 'mission.json' },
      { op: 'analyzeEclipse', id: 'ecl', observer: '-82', body: 'SATURN', grid },
      { op: 'analyzeAccess', id: 'acc', observer: '-82', target: 'SUN', losBody: 'SATURN', grid },
      { op: 'analyzeLinkBudget', id: 'link', observer: '-82', target: 'EARTH', grid, radio: { eirpDbW: 90, freqHz: 8.4e9, gOverTDbK: 53, dataRateBps: 14000 } },
      { op: 'report', from: ['ecl', 'acc'], file: 'report.json' },
    ]);
  });
});
