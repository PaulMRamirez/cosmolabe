// Headline determinism + value oracle: a furnish -> twobody-propagate -> export-OEM job
// runs fully headless against the in-memory PAL, produces a parseable OEM whose first
// state is the seed state, and is byte-identical across two runs. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseOem } from '@bessel/interop';
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
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 600 } },
    { op: 'exportOem', from: 'eph', file: 'eph.oem', metadata: { objectName: 'SAT' } },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(new Map([['naif0012.tls', fixture('naif0012.tls')]])));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

describe('e2e: propagate -> OEM', () => {
  it('runs headless, exits 0, and writes a parseable OEM seeded at the initial state', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('ok');
    expect(files.has('eph.oem')).toBe(true);

    const oem = parseOem(new TextDecoder().decode(files.get('eph.oem')!));
    expect(oem.states.length).toBe(7); // 0..3600 s at 600 s
    expect(oem.metadata.refFrame).toBe('J2000');
    expect(oem.metadata.centerName).toBe('EARTH');
    // First state is the seed state (grid starts at the state epoch).
    expect(oem.states[0]!.position[0]).toBeCloseTo(7000, 3);
    expect(oem.states[0]!.position[1]).toBeCloseTo(0, 3);
    expect(oem.states[0]!.velocity[1]).toBeCloseTo(7.5460491, 6);
  });

  it('is deterministic (two runs produce byte-identical OEM)', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('eph.oem')).toEqual(b.files.get('eph.oem'));
  });
});
