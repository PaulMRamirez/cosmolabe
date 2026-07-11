// Facility elevation access: the Sun rises and sets at an equatorial ground station,
// and every interval boundary is where the solar elevation equals the mask, cross-
// checked against an independent elevation computation. (STK_PARITY_SPEC §4.3.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowMeasure } from '@bessel/timeline';
import { computeElevationAccess, type Facility } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const STATION: Facility = { body: 'EARTH', bodyFrame: 'IAU_EARTH', lonRad: 0, latRad: 0, altKm: 0 };
// A mid-latitude station where the geodetic normal and the geocentric radial diverge most
// (~0.19 deg at 45 deg latitude on Earth), so the two up conventions give measurably different
// elevation windows for a grazing source.
const MID_LAT_STATION: Facility = { body: 'EARTH', bodyFrame: 'IAU_EARTH', lonRad: 0, latRad: Math.PI / 4, altKm: 0 };

describe('computeElevationAccess', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;

  // Independent solar elevation at the station (deg).
  const solarElevationDeg = async (et: number): Promise<number> => {
    const radii = await spice.bodvrd('EARTH', 'RADII');
    const re = radii[0]!;
    const rp = radii[2]!;
    const e2 = ((re - rp) / re) * (2 - (re - rp) / re);
    const n = re / Math.sqrt(1 - e2);
    const fac = { x: n, y: 0, z: 0 }; // lon=lat=0, alt=0
    const up = { x: 1, y: 0, z: 0 };
    const sun = await spice.spkpos('SUN', et, 'IAU_EARTH', 'NONE', 'EARTH');
    const los = { x: sun.position.x - fac.x, y: sun.position.y - fac.y, z: sun.position.z - fac.z };
    const m = Math.hypot(los.x, los.y, los.z);
    return (Math.asin((los.x * up.x + los.y * up.y + los.z * up.z) / m) * 180) / Math.PI;
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-02T00:00:00'); // one day
  });

  it('finds the Sun in view for part of the day (rise/set)', async () => {
    const w = await computeElevationAccess(spice, STATION, 'SUN', [t0, t1], 600, 0);
    const measure = windowMeasure(w);
    expect(measure).toBeGreaterThan(6 * 3600); // at least ~6 h of daylight
    expect(measure).toBeLessThan(18 * 3600); // and not the whole day
  });

  it('places every interior boundary at the elevation mask', async () => {
    const maskDeg = 10;
    const w = await computeElevationAccess(spice, STATION, 'SUN', [t0, t1], 600, (maskDeg * Math.PI) / 180);
    expect(w.length).toBeGreaterThan(0);
    for (const [s, e] of w) {
      for (const b of [s, e]) {
        if (b === t0 || b === t1) continue;
        expect(await solarElevationDeg(b)).toBeCloseTo(maskDeg, 2); // boundary at the 10 deg mask
      }
    }
  });

  it('defaults to the geodetic (STK topocentric) up, with a documented geocentric option', async () => {
    // The default and the explicit geodetic option are identical: the documented convention is
    // the geodetic surface normal, matching an STK topocentric elevation.
    const span: [number, number] = [t0, t1];
    const geodeticDefault = await computeElevationAccess(spice, MID_LAT_STATION, 'SUN', span, 600, 0);
    const geodeticExplicit = await computeElevationAccess(spice, MID_LAT_STATION, 'SUN', span, 600, 0, 'NONE', 'geodetic');
    expect(windowMeasure(geodeticDefault)).toBeCloseTo(windowMeasure(geodeticExplicit), 6);

    // The geocentric-radial option is a genuinely different horizon at a mid-latitude site (the
    // up vectors differ by ~0.19 deg), so the daylight window differs measurably from geodetic.
    const geocentric = await computeElevationAccess(spice, MID_LAT_STATION, 'SUN', span, 600, 0, 'NONE', 'geocentric');
    expect(windowMeasure(geocentric)).toBeGreaterThan(0);
    expect(Math.abs(windowMeasure(geocentric) - windowMeasure(geodeticDefault))).toBeGreaterThan(1);
  });
});
