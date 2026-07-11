// The end-to-end propagation pipeline the app's TLE tool uses: parse a TLE, run
// SGP4 over a grid, publish the arc as an in-memory SPK Type-13 about the Earth, and
// read it back through spkpos. Asserts the published arc is queryable and its
// altitude is physical. (STK_PARITY_SPEC §4.1.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { parseTle } from './tle.ts';
import { sgp4init, sgp4 } from './sgp4.ts';
import { publishEphemeris, type EphemerisTable } from './elements.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

describe('SGP4 -> SPK-13 publish pipeline', () => {
  let spice: SpiceEngine;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc']) await spice.furnsh(k, fixture(k));
  });

  it('publishes a propagated arc that is queryable about the Earth', async () => {
    const tle = parseTle(L1, L2);
    const rec = sgp4init(tle);
    const epoch = await spice.str2et(tle.epochUtc.replace(/Z$/, ''));
    const step = 60;
    const n = 240; // 4 hours is enough to cover the orbit
    const table: EphemerisTable = {
      frame: 'J2000',
      et: new Float64Array(n),
      x: new Float64Array(n),
      y: new Float64Array(n),
      z: new Float64Array(n),
      vx: new Float64Array(n),
      vy: new Float64Array(n),
      vz: new Float64Array(n),
    };
    for (let i = 0; i < n; i++) {
      const t = epoch + i * step;
      (table.et as Float64Array)[i] = t;
      const s = sgp4(rec, (t - epoch) / 60);
      (table.x as Float64Array)[i] = s.position[0];
      (table.y as Float64Array)[i] = s.position[1];
      (table.z as Float64Array)[i] = s.position[2];
      (table.vx as Float64Array)[i] = s.velocity[0];
      (table.vy as Float64Array)[i] = s.velocity[1];
      (table.vz as Float64Array)[i] = s.velocity[2];
    }

    const bodyId = -990000;
    await publishEphemeris(spice, table, { name: 'sat5.bsp', body: bodyId, center: 399, degree: 7 });

    // The published arc reproduces the SGP4 state at a sampled epoch (Hermite fit).
    const mid = table.et[120]!;
    const got = await spice.spkezr(String(bodyId), mid, 'J2000', 'NONE', '399');
    const ref = sgp4(rec, (mid - epoch) / 60);
    expect(got.position.x).toBeCloseTo(ref.position[0], 3);
    expect(got.position.y).toBeCloseTo(ref.position[1], 3);
    expect(got.position.z).toBeCloseTo(ref.position[2], 3);

    // Altitude above the mean Earth radius stays in the satellite-5 regime (eccentric:
    // a few hundred to a few thousand km).
    const re = (await spice.bodvrd('EARTH', 'RADII'))[0]!;
    const r0 = await spice.spkpos(String(bodyId), table.et[0]!, 'J2000', 'NONE', '399');
    const alt = Math.hypot(r0.position.x, r0.position.y, r0.position.z) - re;
    expect(alt).toBeGreaterThan(100);
    expect(alt).toBeLessThan(20000);

    // The sub-satellite point is well defined in the Earth body-fixed frame.
    const bf = await spice.spkpos(String(bodyId), mid, 'IAU_EARTH', 'NONE', '399');
    expect(Number.isFinite(bf.position.x)).toBe(true);
  });
});
