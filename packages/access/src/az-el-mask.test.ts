// Oracle test for the azimuth-elevation mask constraint on the Cassini fixtures. The geometry is
// Cassini (-82) seen from Saturn's center in IAU_SATURN over the SOI window, where the spacecraft
// sweeps a wide range of body-fixed latitude and longitude, so both the elevation floor and the
// azimuth mask have real crossings. The constant-floor case uses gfposc (LATITUDINAL LATITUDE in
// IAU_SATURN); its window is cross-checked against an independent elevation = asin(z / |r|) of the
// Saturn-to-Cassini vector (the latitude of the observer-to-target vector), which equals the floor
// at every interior edge. The az-varying case raises the floor only over the azimuth sector the
// spacecraft crosses at its peak latitude, so it blocks a pass that the same constant lower floor
// admits. (STK_PARITY_SPEC §4.3, ACC az-el mask.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowMeasure } from '@bessel/timeline';
import {
  computeAccess,
  AzElMaskConstraintError,
  interpolateMaskFloor,
  type Facility,
  type MaskPoint,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
// A facility at Saturn's center frame: gfposc takes the LATITUDINAL latitude of the
// Saturn-to-Cassini vector, independent of the (unused-here) site lon/lat/alt.
const FACILITY: Facility = { body: 'SATURN', bodyFrame: 'IAU_SATURN', lonRad: 0, latRad: 0, altKm: 0 };

describe('@bessel/access azElMask constraint', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;

  // Independent elevation (rad) of the Saturn-to-Cassini vector in IAU_SATURN: asin(z / |r|), the
  // LATITUDINAL latitude gfposc uses for the constant-floor case.
  const elevationRad = async (et: number): Promise<number> => {
    const p = (await spice.spkpos(CASSINI, et, 'IAU_SATURN', 'NONE', 'SATURN')).position;
    const r = Math.hypot(p.x, p.y, p.z);
    return Math.asin(p.z / r);
  };
  // Independent azimuth (rad) of the same vector: atan2(y, x).
  const azimuthRad = async (et: number): Promise<number> => {
    const p = (await spice.spkpos(CASSINI, et, 'IAU_SATURN', 'NONE', 'SATURN')).position;
    return Math.atan2(p.y, p.x);
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
  });

  it('interpolateMaskFloor linearly interpolates and wraps around the azimuth circle', () => {
    const mask: MaskPoint[] = [
      { azimuthRad: 0, minElevationRad: 0 },
      { azimuthRad: Math.PI / 2, minElevationRad: 1 },
    ];
    expect(interpolateMaskFloor(mask, Math.PI / 4)).toBeCloseTo(0.5, 12);
    // Wrap segment runs from pi/2 (floor 1) back to 0 + 2pi (floor 0), spanning 3pi/2. At azimuth
    // pi the fraction is (pi - pi/2) / (3pi/2) = 1/3, so the floor is 1 + (1/3)(0 - 1) = 2/3.
    expect(interpolateMaskFloor(mask, Math.PI)).toBeCloseTo(2 / 3, 12);
  });

  it('constant floor: gfposc window edges sit at the elevation floor (independent asin(z/|r|))', async () => {
    // Pick a floor the Cassini elevation actually crosses over the span, so there are interior edges.
    const samples = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((h) => elevationRad(t0 + h * 3600)));
    const minElevationRad = (Math.min(...samples) + Math.max(...samples)) / 2;

    const w = await computeAccess(spice, {
      observer: 'SATURN', target: CASSINI, span: [t0, t1], step: 300,
      constraints: [{ kind: 'azElMask', facility: FACILITY, minElevationRad }],
    });
    expect(w.length).toBeGreaterThan(0);
    expect(windowMeasure(w)).toBeGreaterThan(0);
    expect(windowMeasure(w)).toBeLessThan(t1 - t0); // not the whole span
    for (const [s, e] of w) {
      for (const b of [s, e]) {
        if (b === t0 || b === t1) continue;
        expect(await elevationRad(b)).toBeCloseTo(minElevationRad, 4);
      }
    }
  });

  it('an azimuth-varying mask blocks a peak-latitude pass a constant lower floor admits', async () => {
    // Find the spacecraft's peak body-fixed latitude (elevation) and its azimuth there.
    let peakEt = t0;
    let peakEl = -Infinity;
    for (let i = 0; i <= 72; i++) {
      const et = t0 + (i / 72) * (t1 - t0);
      const el = await elevationRad(et);
      if (el > peakEl) {
        peakEl = el;
        peakEt = et;
      }
    }
    const peakAz = await azimuthRad(peakEt);

    // A constant floor well below the peak, so the peak epoch is comfortably admitted.
    const lowFloor = peakEl - (10 * Math.PI) / 180;
    const lowFloorW = await computeAccess(spice, {
      observer: 'SATURN', target: CASSINI, span: [t0, t1], step: 120,
      constraints: [{ kind: 'azElMask', facility: FACILITY, minElevationRad: lowFloor }],
    });

    // A mask that is the same low floor everywhere EXCEPT a wall over a narrow azimuth sector
    // centred on the peak azimuth, set above the peak elevation so it blocks the pass there.
    const wall = peakEl + (5 * Math.PI) / 180; // taller than the spacecraft ever climbs
    const d = 0.2; // half-width of the blocked sector (rad)
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    const mask: MaskPoint[] = [
      { azimuthRad: wrap(peakAz - d), minElevationRad: lowFloor },
      { azimuthRad: wrap(peakAz), minElevationRad: wall },
      { azimuthRad: wrap(peakAz + d), minElevationRad: lowFloor },
      { azimuthRad: wrap(peakAz + Math.PI), minElevationRad: lowFloor },
    ].sort((a, b) => a.azimuthRad - b.azimuthRad);

    const maskW = await computeAccess(spice, {
      observer: 'SATURN', target: CASSINI, span: [t0, t1], step: 120,
      constraints: [{ kind: 'azElMask', facility: FACILITY, mask }],
    });

    // The az-varying mask removes time the constant lower floor admitted (the peak-azimuth wall).
    expect(windowMeasure(maskW)).toBeLessThan(windowMeasure(lowFloorW));
    // The peak epoch itself is admitted by the low floor but blocked by the wall.
    const inLow = lowFloorW.some(([s, e]) => peakEt >= s && peakEt <= e);
    const inMask = maskW.some(([s, e]) => peakEt >= s && peakEt <= e);
    expect(inLow).toBe(true);
    expect(inMask).toBe(false);
  });

  it('fails loud on an empty mask and on both/neither floor given', async () => {
    await expect(
      computeAccess(spice, {
        observer: 'SATURN', target: CASSINI, span: [t0, t1], step: 600,
        constraints: [{ kind: 'azElMask', facility: FACILITY, mask: [] }],
      }),
    ).rejects.toBeInstanceOf(AzElMaskConstraintError);
    await expect(
      computeAccess(spice, {
        observer: 'SATURN', target: CASSINI, span: [t0, t1], step: 600,
        constraints: [{ kind: 'azElMask', facility: FACILITY }],
      }),
    ).rejects.toBeInstanceOf(AzElMaskConstraintError);
  });
});
