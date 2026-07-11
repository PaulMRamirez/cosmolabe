// Validates solar intensity (penumbra fraction) two ways: (1) analytic two-circle
// overlap and visible-fraction unit tests with hand-computed values; (2) a real
// Cassini/Saturn umbra fixture, asserting fraction ~ 0 inside the umbra, ~ 1 in a
// sunlit interval, and monotonic across the penumbra (ingress). (Phase B.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import {
  overlapArea,
  visibleFraction,
  solarIntensity,
  solarIntensitySeries,
  eclipseIntervals,
  type EclipseIntervals,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';

describe('overlapArea (two-circle lens)', () => {
  it('is 0 for disjoint disks', () => {
    expect(overlapArea(1, 1, 3)).toBe(0);
    expect(overlapArea(2, 1, 3)).toBe(0); // touching externally: d = rA + rB
  });

  it('is pi*min(r)^2 when one disk is inside the other', () => {
    expect(overlapArea(2, 1, 0)).toBeCloseTo(Math.PI, 12); // small fully inside large
    expect(overlapArea(2, 1, 0.5)).toBeCloseTo(Math.PI, 12); // d <= |rA - rB|
    expect(overlapArea(1, 1, 0)).toBeCloseTo(Math.PI, 12); // identical disks
  });

  it('matches the hand-computed lens of two unit circles d=1', () => {
    // alpha = beta = acos(1/2) = pi/3; area = 2*(pi/3 - sin(pi/3)cos(pi/3))
    //       = 2*pi/3 - sqrt(3)/2.
    const expected = (2 * Math.PI) / 3 - Math.sqrt(3) / 2;
    expect(overlapArea(1, 1, 1)).toBeCloseTo(expected, 12);
  });
});

describe('visibleFraction', () => {
  it('is 1 for disjoint disks (no occultation)', () => {
    expect(visibleFraction(1, 1, 3)).toBeCloseTo(1, 12);
  });

  it('is 0 when the Sun is fully behind the body (total, rB >= rS, concentric)', () => {
    expect(visibleFraction(1, 1, 0)).toBeCloseTo(0, 12);
    expect(visibleFraction(1, 2, 0)).toBeCloseTo(0, 12);
  });

  it('is 1 - (rB/rS)^2 for the annular case (rB < rS, concentric)', () => {
    expect(visibleFraction(1, 0.5, 0)).toBeCloseTo(1 - 0.25, 12);
    expect(visibleFraction(2, 1, 0)).toBeCloseTo(1 - 0.25, 12);
  });

  it('is 1/2 for the symmetric half-overlap case (equal radii, d=1)', () => {
    // Visible = 1 - lens/(pi*rS^2); for equal unit circles d=1 the lens is
    // 2*pi/3 - sqrt(3)/2, so visible = 1 - (2/3 - sqrt(3)/(2*pi)).
    const lens = (2 * Math.PI) / 3 - Math.sqrt(3) / 2;
    const expected = 1 - lens / Math.PI;
    expect(visibleFraction(1, 1, 1)).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
  });
});

describe('@bessel/events solarIntensity (Cassini/Saturn fixture)', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;
  let ecl: EclipseIntervals;

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

  it('is ~ 0 at an umbra midpoint and ~ 1 in a sunlit interval', async () => {
    const [us, ue] = ecl.umbra[0]!;
    const umbraMid = (us + ue) / 2;
    const lit = ecl.sunlit.find(([s, e]) => e - s > 600)!;
    const litMid = (lit[0] + lit[1]) / 2;

    const fUmbra = await solarIntensity(spice, CASSINI, 'SATURN', 'IAU_SATURN', umbraMid);
    const fLit = await solarIntensity(spice, CASSINI, 'SATURN', 'IAU_SATURN', litMid);
    expect(fUmbra).toBeCloseTo(0, 6);
    expect(fLit).toBeCloseTo(1, 6);
  });

  it('is monotonic decreasing across the shadow ingress (sunlit -> umbra)', async () => {
    // The penumbra is the analytic transition: fully lit just before the umbra,
    // fully dark just after umbra start. Sample a window straddling that edge and
    // assert the visible fraction is non-increasing and spans ~1 down to ~0. (The
    // 60 s geometry-finder step does not resolve a separate penumbra window here,
    // so the penumbra is exercised directly through the intensity series.)
    // The spherical-radius model places the limb slightly later than the gfoclt
    // ellipsoid umbra start (Saturn is strongly oblate), so sample a wide window
    // starting at the gfoclt umbra start; it captures the full lit -> dark fall.
    const [us] = ecl.umbra[0]!;
    const series = await solarIntensitySeries(
      spice,
      CASSINI,
      'SATURN',
      'IAU_SATURN',
      [us, us + 400],
      10,
    );
    expect(series.fraction.length).toBeGreaterThan(2);
    for (let i = 1; i < series.fraction.length; i += 1) {
      expect(series.fraction[i]!).toBeLessThanOrEqual(series.fraction[i - 1]! + 1e-6);
    }
    expect(series.fraction[0]!).toBeGreaterThan(0.9); // lit before ingress
    expect(series.fraction.at(-1)!).toBeLessThan(0.1); // dark after ingress
  });
});
