// The analyzeAccess op end to end: furnish the Cassini-at-Saturn fixture kernels and find
// the spacecraft's line-of-sight access to the Sun (occulted by Saturn) near orbit
// insertion, exported to CSV. The oracle is an independent @bessel/access computeAccess
// call over the same loaded kernels; the artifact is byte-identical across two runs.
// (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createSpiceEngine } from '@bessel/spice';
import { computeAccess } from '@bessel/access';
import { runJob } from './run.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
const START = '2004-07-01T00:00:00';
const STOP = '2004-07-01T06:00:00';
const STEP = 60;
const KERNELS = ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'] as const;

const kernelMap = (): Map<string, Uint8Array> => new Map(KERNELS.map((k) => [k, fixture(k)]));

const JOB: BatchJob = {
  besselBatch: '1',
  operations: [
    { op: 'furnish', names: [...KERNELS] },
    { op: 'analyzeAccess', id: 'acc', observer: CASSINI, target: 'SUN', losBody: 'SATURN', grid: { start: START, stop: STOP, stepSec: STEP } },
    { op: 'exportCsv', from: 'acc', file: 'access.csv' },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(kernelMap()));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

const parseIntervals = (csv: string): [string, string][] =>
  csv
    .trimEnd()
    .split('\n')
    .slice(1)
    .filter((l) => l.length > 0)
    .map((l) => {
      const [a, b] = l.split(',');
      return [a!, b!] as [string, string];
    });

describe('e2e: furnish -> analyzeAccess(Cassini sees Sun) -> CSV', () => {
  it('finds access intervals matching an independent computeAccess oracle', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const opIntervals = parseIntervals(new TextDecoder().decode(files.get('access.csv')!));

    // Oracle: a fresh engine with the same kernels, the same line-of-sight constraint.
    const engine = await createSpiceEngine();
    try {
      for (const k of KERNELS) await engine.furnsh(k, kernelMap().get(k)!);
      const t0 = await engine.str2et(START);
      // The op derives its span from the resolved grid (last sample, not str2et(stop)).
      const t1 = t0 + Math.floor(((await engine.str2et(STOP)) - t0) / STEP) * STEP;
      const window = await computeAccess(engine, {
        observer: CASSINI,
        target: 'SUN',
        span: [t0, t1],
        step: STEP,
        constraints: [{ kind: 'lineOfSight', body: 'SATURN', bodyFrame: 'IAU_SATURN' }],
      });
      const oracle: [string, string][] = [];
      for (const [s, e] of window) {
        oracle.push([await engine.et2utc(s, 'ISOC', 6), await engine.et2utc(e, 'ISOC', 6)]);
      }
      expect(oracle.length).toBeGreaterThan(0); // Cassini sees the Sun for part of the span.
      expect(opIntervals).toEqual(oracle);
    } finally {
      await engine.kclear();
    }
  });

  it('is deterministic across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('access.csv')).toEqual(b.files.get('access.csv'));
  });
});
