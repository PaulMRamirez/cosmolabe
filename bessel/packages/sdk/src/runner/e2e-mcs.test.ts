// The MCS op wired end to end: a furnish -> runMcs -> export-OEM job runs the mission
// sequence (coast, prograde burn, coast) with SPICE-free dynamics and serializes the arc.
// Proves the SDK drives the propagator MCS executor headlessly and deterministically.
// (STK_PARITY_SPEC, SDK.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseOem } from '@bessel/interop';
import type { Mcs } from '@bessel/propagator';
import { runJob } from './run.ts';
import { memoryKernelSource, recordingIo } from '../testing/memory-pal.ts';
import type { BatchJob } from '../job/types.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const vCirc = Math.sqrt(398600.4418 / 7000);
const mcs: Mcs = {
  version: 1,
  root: {
    kind: 'Sequence',
    id: 'root',
    children: [
      { kind: 'InitialState', id: 'ini', epoch: 0, centralBody: 399, mass: 1000, frame: 'J2000', coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: vCirc, z: 0 } } },
      { kind: 'Propagate', id: 'c1', model: 'TwoBody', maxDuration: 1800, sampleStep: 300, stop: [{ type: 'Duration', value: 1800 }] },
      { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.05, y: 0, z: 0 } },
      { kind: 'Propagate', id: 'c2', model: 'TwoBody', maxDuration: 1800, sampleStep: 300, stop: [{ type: 'Duration', value: 1800 }] },
    ],
  },
};

const JOB: BatchJob = {
  besselBatch: '1',
  operations: [
    { op: 'furnish', names: ['naif0012.tls'] },
    { op: 'runMcs', id: 'tx', mcs, bodies: { 399: { gm: 398600.4418, bodyRadius: 6378.137 } } },
    { op: 'exportOem', from: 'tx', file: 'tx.oem', metadata: { objectName: 'TX' } },
  ],
  output: { dir: 'out' },
};

const run = async () => {
  const { io, files } = recordingIo(memoryKernelSource(new Map([['naif0012.tls', fixture('naif0012.tls')]])));
  const result = await runJob({ job: JOB, io });
  return { result, files };
};

describe('e2e: runMcs -> OEM', () => {
  it('executes the mission and serializes a parseable arc', async () => {
    const { result, files } = await run();
    expect(result.exitCode).toBe(0);
    const oem = parseOem(new TextDecoder().decode(files.get('tx.oem')!));
    expect(oem.states.length).toBeGreaterThan(10);
    // The prograde burn raised the orbital energy: a later sample exceeds the initial speed.
    const speeds = oem.states.map((s) => Math.hypot(s.velocity[0], s.velocity[1], s.velocity[2]));
    expect(Math.max(...speeds)).toBeGreaterThan(vCirc + 0.02);
  });

  it('is deterministic across two runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.files.get('tx.oem')).toEqual(b.files.get('tx.oem'));
  });
});
