// OEM -> SPK import: a parsed OEM publishes to an in-memory SPK Type-13 whose spkpos
// reproduces the message states (so an external ephemeris renders through the same
// pipeline). Uses a small synthetic OEM about the Earth. (STK_PARITY_SPEC §4.11.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { publishOem, type OemLike } from './oem-import.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

describe('publishOem (OEM -> SPK import)', () => {
  let spice: SpiceEngine;
  beforeAll(async () => {
    spice = await createSpiceEngine();
    await spice.furnsh('naif0012.tls', fixture('naif0012.tls'));
  });

  it('publishes an importable OEM that spkpos reproduces', async () => {
    // A short straight-line-ish arc (the Hermite fit reproduces the nodes exactly).
    const states = Array.from({ length: 6 }, (_, i) => ({
      epoch: `2004-001T00:0${i}:00.000`,
      position: [7000 + i, 100 * i, -50 * i] as [number, number, number],
      velocity: [0.1, 7.5, 0.2] as [number, number, number],
    }));
    const oem: OemLike = { metadata: { refFrame: 'EME2000' }, states };
    const bodyId = -424242;
    const table = await publishOem(spice, oem, { name: 'import.oem.bsp', body: bodyId, center: 399, degree: 5 });

    expect(table.frame).toBe('J2000'); // EME2000 mapped to J2000
    const mid = table.et[3]!;
    const got = await spice.spkpos(String(bodyId), mid, 'J2000', 'NONE', '399');
    expect(got.position.x).toBeCloseTo(table.x[3]!, 4);
    expect(got.position.y).toBeCloseTo(table.y[3]!, 4);
    expect(got.position.z).toBeCloseTo(table.z[3]!, 4);
  });
});
