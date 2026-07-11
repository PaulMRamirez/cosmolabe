// PROP-6: a propagated EphemerisTable, published as an in-memory SPK Type 13
// segment, is queryable through the identical spkezr path (one geometry source of
// truth). Validates the SPK round-trip at the segment nodes. (STK_PARITY_SPEC §4.1.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { propagateTwoBody, publishEphemeris } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const EARTH_GM = 398600.4418;
const PROBE = -999;
const EARTH = 399;

describe('publishEphemeris (SPK Type 13 round-trip)', () => {
  let spice: SpiceEngine;
  let epoch: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    await spice.furnsh('naif0012.tls', fixture('naif0012.tls'));
    epoch = await spice.str2et('2020-01-01T00:00:00');
  });

  it('reproduces the propagated states at the segment nodes via spkezr', async () => {
    // A near-circular equatorial orbit, propagated over one period.
    const a = 7000;
    const v = Math.sqrt(EARTH_GM / a);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / EARTH_GM);
    const state = { position: { x: a, y: 0, z: 0 }, velocity: { x: 0, y: v, z: 0 } };
    const n = 25;
    const grid = Float64Array.from({ length: n }, (_, k) => epoch + (period * k) / (n - 1));
    const table = await propagateTwoBody(spice, state, EARTH_GM, epoch, grid);

    await publishEphemeris(spice, table, { name: 'probe.bsp', body: PROBE, center: EARTH });

    // At interior nodes the Hermite segment passes through the propagated states.
    for (let k = 1; k < n - 1; k++) {
      const sv = await spice.spkezr(String(PROBE), grid[k]!, 'J2000', 'NONE', String(EARTH));
      expect(sv.position.x).toBeCloseTo(table.x[k]!, 5);
      expect(sv.position.y).toBeCloseTo(table.y[k]!, 5);
      expect(sv.position.z).toBeCloseTo(table.z[k]!, 5);
      expect(sv.velocity.y).toBeCloseTo(table.vy[k]!, 8);
    }

    await spice.unload('probe.bsp');
  });
});
