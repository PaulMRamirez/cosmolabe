// The analyzeLinkBudget op end to end: furnish the Cassini fixture kernels, sample the
// Cassini-to-Earth range over a span, and roll up the @bessel/rf link budget into a
// (range, pathLoss, ebN0, margin) CSV. The oracle for the first range is ||spkpos(EARTH
// relative to Cassini)|| and the first path loss is the Friis loss at that range; the
// artifact is byte-identical across two runs. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createSpiceEngine } from '@bessel/spice';
import { friisPathLossDb } from '@bessel/rf';
import { runJob } from './run.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
const START = '2004-07-01T00:00:00';
const STOP = '2004-07-01T02:00:00';
const STEP = 600;
const FREQ_HZ = 8.4e9;
const KERNELS = ['naif0012.tls', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'] as const;

const kernelMap = (): Map<string, Uint8Array> => new Map(KERNELS.map((k) => [k, fixture(k)]));

const JOB: BatchJob = {
  besselBatch: '1',
  operations: [
    { op: 'furnish', names: [...KERNELS] },
    {
      op: 'analyzeLinkBudget',
      id: 'link',
      observer: CASSINI,
      target: 'EARTH',
      grid: { start: START, stop: STOP, stepSec: STEP },
      radio: { eirpDbW: 90, freqHz: FREQ_HZ, gOverTDbK: 53, dataRateBps: 14000, requiredEbN0Db: 2.5 },
    },
    { op: 'exportCsv', from: 'link', file: 'link.csv' },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(kernelMap()));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

const rows = (csv: string): string[][] =>
  csv.trimEnd().split('\n').map((l) => l.split(','));

describe('e2e: furnish -> analyzeLinkBudget(Cassini to Earth) -> CSV', () => {
  it('first range equals ||spkpos(EARTH relative to Cassini)|| and the path loss follows Friis', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const csv = new TextDecoder().decode(files.get('link.csv')!);
    const r = rows(csv);
    expect(r[0]).toEqual(['utc', 'range_km', 'pathLoss_dB', 'ebN0_dB', 'margin_dB']);

    const firstRange = Number(r[1]![1]);
    const firstPathLoss = Number(r[1]![2]);

    // Oracle: a fresh engine computes the geometric range and the Friis path loss directly.
    const engine = await createSpiceEngine();
    try {
      for (const k of KERNELS) await engine.furnsh(k, kernelMap().get(k)!);
      const et0 = await engine.str2et(START);
      const p = await engine.spkpos('EARTH', et0, 'J2000', 'NONE', CASSINI);
      const rangeKm = Math.hypot(p.position.x, p.position.y, p.position.z);
      // CSV cells are rounded to 6 significant figures; compare at that precision.
      expect(firstRange).toBeCloseTo(Number(rangeKm.toPrecision(6)), 3);
      expect(firstPathLoss).toBeCloseTo(Number(friisPathLossDb(rangeKm, FREQ_HZ).toPrecision(6)), 3);
    } finally {
      await engine.kclear();
    }
  });

  it('is deterministic across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('link.csv')).toEqual(b.files.get('link.csv'));
  });
});
