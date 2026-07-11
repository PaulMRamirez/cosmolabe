// The loadCatalog op end to end: read a Cosmographia catalog as text through the RunIo
// seam, furnish the kernels it references, then run a range analysis that depends on those
// kernels and export it to CSV. The oracle for the first range is an independent spkezr
// call; the artifact is byte-identical across two runs. (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createSpiceEngine } from '@bessel/spice';
import { runJob } from './run.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
const START = '2004-07-01T00:00:00';
const STOP = '2004-07-01T01:00:00';
const STEP = 600;
const KERNELS = ['naif0012.tls', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp'] as const;

const CATALOG = JSON.stringify({
  version: '1.0',
  name: 'Cassini at Saturn',
  spiceKernels: [...KERNELS],
  items: [
    {
      class: 'spacecraft',
      name: 'Cassini',
      trajectory: { type: 'Spice', target: CASSINI, center: '6', frame: 'J2000' },
    },
  ],
});

const kernelMap = (): Map<string, Uint8Array> => new Map(KERNELS.map((k) => [k, fixture(k)]));

const JOB: BatchJob = {
  besselBatch: '1',
  operations: [
    { op: 'loadCatalog', file: 'mission.json' },
    { op: 'analyze', id: 'rng', kind: 'range', observer: CASSINI, target: 'EARTH', grid: { start: START, stop: STOP, stepSec: STEP } },
    { op: 'exportCsv', from: 'rng', file: 'rng.csv' },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(kernelMap()), new Map([['mission.json', CATALOG]]));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

describe('e2e: loadCatalog -> analyze range -> CSV', () => {
  it('furnishes the catalog kernels so the range analysis matches an spkezr oracle', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const r = new TextDecoder().decode(files.get('rng.csv')!).trimEnd().split('\n');
    expect(r[0]).toBe('utc,range_km,rangeRate_kmps');
    const firstRange = Number(r[1]!.split(',')[1]);

    const engine = await createSpiceEngine();
    try {
      for (const k of KERNELS) await engine.furnsh(k, kernelMap().get(k)!);
      const et0 = await engine.str2et(START);
      const s = await engine.spkezr('EARTH', et0, 'J2000', 'NONE', CASSINI);
      const rangeKm = Math.hypot(s.position.x, s.position.y, s.position.z);
      expect(firstRange).toBeCloseTo(Number(rangeKm.toPrecision(6)), 3);
    } finally {
      await engine.kclear();
    }
  });

  it('fails loudly when the RunIo has no readText seam', async () => {
    const { io } = recordingIo(memoryKernelSource(kernelMap())); // no texts -> no readText
    const result = await runJob({ job: JOB, io });
    expect(result.exitCode).toBe(1);
    expect(result.ops[0]!.status).toBe('failed');
    expect(result.ops[0]!.error?.code).toBe('catalog-load');
  });

  it('is deterministic across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('rng.csv')).toEqual(b.files.get('rng.csv'));
  });
});
