// Validates the eclipse classification against the per-epoch occult reference: the
// umbra is where the Sun is totally occulted (occult code -3), sunlit where it is
// clear (0), and the four conditions partition the span. (STK_PARITY_SPEC §4.9.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowMeasure, windowContains } from '@bessel/timeline';
import { eclipseIntervals, type EclipseIntervals } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';

describe('@bessel/events eclipseIntervals', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;
  let ecl: EclipseIntervals;

  // Sun (ellipsoid) occulted by Saturn from Cassini, the per-epoch reference.
  const occultCode = (et: number) =>
    spice.occult('SUN', 'ELLIPSOID', 'IAU_SUN', 'SATURN', 'ELLIPSOID', 'IAU_SATURN', 'NONE', CASSINI, et);

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
    ecl = await eclipseIntervals(spice, {
      observer: CASSINI,
      body: 'SATURN',
      bodyFrame: 'IAU_SATURN',
      span: [t0, t1],
      step: 60,
    });
  });

  it('finds a total-shadow (umbra) interval near SOI', () => {
    expect(windowMeasure(ecl.umbra)).toBeGreaterThan(0);
  });

  it('partitions the span into the four lighting conditions', () => {
    const total =
      windowMeasure(ecl.umbra) +
      windowMeasure(ecl.penumbra) +
      windowMeasure(ecl.annular) +
      windowMeasure(ecl.sunlit);
    expect(total).toBeCloseTo(t1 - t0, 2);
  });

  it('occult confirms total occultation inside the umbra', async () => {
    const [s, e] = ecl.umbra[0]!;
    expect(await occultCode((s + e) / 2)).toBe(-3); // SPICE_OCCULT_TOTAL of the Sun
  });

  it('occult confirms no occultation in a sunlit interval', async () => {
    const lit = ecl.sunlit.find(([s, e]) => e - s > 600);
    expect(lit).toBeDefined();
    const [s, e] = lit!;
    expect(windowContains(ecl.umbra, (s + e) / 2)).toBe(false);
    expect(await occultCode((s + e) / 2)).toBe(0);
  });
});
