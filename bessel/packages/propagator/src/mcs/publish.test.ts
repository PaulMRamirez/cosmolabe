// End-to-end smoke: an MCS run's concatenated samples form a monotone, duplicate-free
// ephemeris that flows through the existing publishEphemeris -> SPK -> spkezr pipeline with
// no special path, the same way the analytic and Cowell arcs do. (STK_PARITY_SPEC §4.3.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { runMcs } from './executor.ts';
import { createMissionEnv } from './env.ts';
import { emptyTable, publishEphemeris, type EphemerisTable } from '../elements.ts';
import type { Mcs, StateSample } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const MU = 398600.4418;
const env = createMissionEnv(new Map([[399, { gm: MU, bodyRadius: 6378.137 }]]), { rtol: 1e-12, atol: 1e-12 });
const vCirc = Math.sqrt(MU / 7000);

function tableFromSamples(samples: readonly StateSample[]): EphemerisTable {
  const et = Float64Array.from(samples, (s) => s.et);
  const table = emptyTable('J2000', et);
  samples.forEach((s, k) => {
    (table.x as Float64Array)[k] = s.state.position.x;
    (table.y as Float64Array)[k] = s.state.position.y;
    (table.z as Float64Array)[k] = s.state.position.z;
    (table.vx as Float64Array)[k] = s.state.velocity.x;
    (table.vy as Float64Array)[k] = s.state.velocity.y;
    (table.vz as Float64Array)[k] = s.state.velocity.z;
  });
  return table;
}

const mcs: Mcs = {
  version: 1,
  root: {
    kind: 'Sequence',
    id: 'root',
    children: [
      {
        kind: 'InitialState',
        id: 'ini',
        epoch: 0,
        centralBody: 399,
        mass: 1000,
        frame: 'J2000',
        coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: vCirc, z: 0 } },
      },
      { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.05, y: 0, z: 0 } },
      { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 3000, sampleStep: 100, stop: [{ type: 'Duration', value: 3000 }] },
    ],
  },
};

describe('MCS run publishes through the SPK pipeline', () => {
  let spice: SpiceEngine;
  beforeAll(async () => {
    spice = await createSpiceEngine();
    await spice.furnsh('naif0012.tls', fixture('naif0012.tls'));
  });

  it('yields a monotone, duplicate-free table that spkezr reproduces', async () => {
    const run = runMcs(mcs, env);
    const table = tableFromSamples(run.samples);
    for (let k = 1; k < table.et.length; k++) {
      expect(table.et[k]!).toBeGreaterThan(table.et[k - 1]!); // strictly increasing, no dup
    }
    const bodyId = -999042;
    await publishEphemeris(spice, table, { name: 'mcs.bsp', body: bodyId, center: 399, degree: 7 });
    const mid = table.et[Math.floor(table.et.length / 2)]!;
    const got = await spice.spkezr(String(bodyId), mid, 'J2000', 'NONE', '399');
    const k = Math.floor(table.et.length / 2);
    expect(got.position.x).toBeCloseTo(table.x[k]!, 3);
    expect(got.position.y).toBeCloseTo(table.y[k]!, 3);
    expect(got.position.z).toBeCloseTo(table.z[k]!, 3);
  });
});
