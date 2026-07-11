// The report op and the run provenance manifest end to end: furnish the Cassini fixture
// kernels, run an eclipse and an access producer, and reduce them to a canonical JSON
// summary; the run also returns a manifest of kernel digests, op statuses, and output
// hashes. Oracles: the report's eclipse coverage matches an independent figureOfMerit, the
// report bytes are byte-identical across runs, and each manifest output hash equals the
// sha256 of the written bytes. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createSpiceEngine } from '@bessel/spice';
import { eclipseIntervals } from '@bessel/events';
import { figureOfMerit } from '@bessel/coverage';
import { runJob } from './run.ts';
import { sha256Hex } from './manifest.ts';
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
    { op: 'analyzeEclipse', id: 'ecl', observer: CASSINI, body: 'SATURN', grid: { start: START, stop: STOP, stepSec: STEP } },
    { op: 'analyzeAccess', id: 'acc', observer: CASSINI, target: 'SUN', losBody: 'SATURN', grid: { start: START, stop: STOP, stepSec: STEP } },
    { op: 'report', from: ['ecl', 'acc'], file: 'report.json' },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(kernelMap()));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

describe('e2e: furnish -> analyzeEclipse + analyzeAccess -> report (+ manifest)', () => {
  it("report's eclipse coverage matches an independent figureOfMerit oracle", async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(new TextDecoder().decode(files.get('report.json')!)) as {
      producers: Record<string, { kind: string; percentCoverage: number }>;
    };
    expect(Object.keys(report.producers).sort()).toEqual(['acc', 'ecl']);

    // Oracle: recompute the umbra window directly and its figure of merit.
    const engine = await createSpiceEngine();
    try {
      for (const k of KERNELS) await engine.furnsh(k, kernelMap().get(k)!);
      const t0 = await engine.str2et(START);
      // The op derives its span from the resolved grid (last sample, not str2et(stop)).
      const t1 = t0 + Math.floor(((await engine.str2et(STOP)) - t0) / STEP) * STEP;
      const intervals = await eclipseIntervals(engine, { observer: CASSINI, body: 'SATURN', bodyFrame: 'IAU_SATURN', span: [t0, t1], step: STEP });
      const fom = figureOfMerit(intervals.umbra, [t0, t1]);
      expect(report.producers.ecl!.kind).toBe('intervals');
      expect(report.producers.ecl!.percentCoverage).toBeCloseTo(Number(fom.percentCoverage.toPrecision(9)), 9);
    } finally {
      await engine.kclear();
    }
  });

  it('produces a byte-identical report across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('report.json')).toEqual(b.files.get('report.json'));
  });

  it('returns a manifest with kernel digests, op statuses, and output hashes', async () => {
    const { result, files } = await run();
    const m = result.manifest;
    expect(m.besselBatch).toBe('1');
    // Every furnished kernel is digested once, in furnish order.
    expect(m.kernels.map((k) => k.name)).toEqual([...KERNELS]);
    for (const k of m.kernels) expect(k.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Op statuses mirror the run records.
    expect(m.ops.map((o) => o.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    // Each output hash is the sha256 of the bytes actually written.
    expect(m.outputs.map((o) => o.path)).toEqual(['report.json']);
    expect(m.outputs[0]!.sha256).toBe(await sha256Hex(files.get('report.json')!));
  });

  it('manifest hashes are stable across two runs', async () => {
    const a = (await run()).result.manifest;
    const b = (await run()).result.manifest;
    expect(a.kernels).toEqual(b.kernels);
    expect(a.outputs).toEqual(b.outputs);
  });
});
