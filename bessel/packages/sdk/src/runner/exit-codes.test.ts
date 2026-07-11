// The CI-facing exit-code contract: a missing kernel under onError 'stop' halts with code
// 1 and writes nothing; a failing op under 'continue' yields code 3 while siblings still
// produce artifacts; a dry run is code 0 with no writes; a dangling reference throws before
// anything executes. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runJob } from './run.ts';
import { JobReferenceError } from '../errors.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const kernels = () => memoryKernelSource(new Map([['naif0012.tls', fixture('naif0012.tls')]]));

const propJob = (onError: 'stop' | 'continue', furnishNames: string[]): BatchJob => ({
  besselBatch: '1',
  entities: { SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-03-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.546, 0] } } },
  operations: [
    { op: 'furnish', names: furnishNames },
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:30:00', stepSec: 600 } },
    { op: 'exportOem', from: 'eph', file: 'eph.oem' },
  ],
  output: { dir: 'out', onError },
});

describe('exit-code contract', () => {
  it('missing kernel under onError stop -> exit 1, no files written', async () => {
    const { io, files } = recordingIo(kernels());
    const result = await runJob({ job: propJob('stop', ['does-not-exist.tls']), io });
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('failed');
    expect(files.size).toBe(0);
    expect(result.ops[0]!.status).toBe('failed');
    expect(result.ops[0]!.error?.code).toBe('kernel-resolve');
    expect(result.ops[2]!.status).toBe('skipped'); // export never reached
  });

  it('a failing op under onError continue -> exit 3, siblings still run', async () => {
    // The propagate references a missing entity (fails); a sibling furnish/analyze still runs.
    const job: BatchJob = {
      besselBatch: '1',
      operations: [
        { op: 'furnish', names: ['naif0012.tls'] },
        { op: 'propagate', id: 'bad', object: 'GHOST', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:10:00', stepSec: 300 } },
        { op: 'analyze', id: 'rng', kind: 'range', observer: '399', target: '10', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:10:00', stepSec: 300 } },
      ],
      output: { dir: 'out', onError: 'continue' },
    };
    const { io } = recordingIo(kernels());
    const result = await runJob({ job, io });
    expect(result.exitCode).toBe(3);
    expect(result.status).toBe('completed-with-failures');
    expect(result.ops[1]!.status).toBe('failed');
    expect(result.ops[0]!.status).toBe('ok'); // furnish still ran
  });

  it('dry run -> exit 0, nothing written', async () => {
    const { io, files } = recordingIo(kernels());
    const result = await runJob({ job: propJob('stop', ['naif0012.tls']), io, dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(files.size).toBe(0);
    expect(result.ops.every((o) => o.status === 'skipped')).toBe(true);
  });

  it('a dangling export reference throws before execution', async () => {
    const job: BatchJob = {
      besselBatch: '1',
      operations: [{ op: 'exportOem', from: 'ghost', file: 'x.oem' }],
      output: { dir: 'out' },
    };
    const { io, files } = recordingIo(kernels());
    await expect(runJob({ job, io })).rejects.toBeInstanceOf(JobReferenceError);
    expect(files.size).toBe(0);
  });
});
