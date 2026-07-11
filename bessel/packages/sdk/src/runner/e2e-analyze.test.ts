// The analyze + publish chain: propagate with publishAs writes an SPK into the pool, then
// an analyze range op queries it through the engine and exports CSV. Proves the
// produce -> publish -> query -> export wiring, deterministically. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runJob } from './run.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const JOB: BatchJob = {
  besselBatch: '1',
  entities: {
    SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-03-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.5460491, 0] } },
  },
  operations: [
    { op: 'furnish', names: ['naif0012.tls'] },
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:30:00', stepSec: 300 }, publishAs: { naifId: -999100 } },
    { op: 'analyze', id: 'rng', kind: 'range', observer: '399', target: '-999100', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:30:00', stepSec: 300 } },
    { op: 'exportCsv', from: 'rng', file: 'rng.csv' },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(new Map([['naif0012.tls', fixture('naif0012.tls')]])));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

describe('e2e: propagate(publish) -> analyze range -> CSV', () => {
  it('writes a CSV whose first range is the initial radius', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const csv = new TextDecoder().decode(files.get('rng.csv')!);
    const rows = csv.trimEnd().split('\n');
    expect(rows[0]).toBe('utc,range_km,rangeRate_kmps');
    expect(rows.length).toBe(1 + 7); // header + 7 samples (0..1800 s at 300 s)
    // First range equals the seed radius 7000 km (the published arc starts there).
    const firstRange = Number(rows[1]!.split(',')[1]);
    expect(firstRange).toBeCloseTo(7000, 0);
  });

  it('is deterministic across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('rng.csv')).toEqual(b.files.get('rng.csv'));
  });
});
