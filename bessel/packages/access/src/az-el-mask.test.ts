// Oracle test for the azimuth-elevation mask constraint on the Cassini fixtures. The geometry is
// Cassini (-82) seen from a real facility on Saturn (a non-body-center site at a chosen
// lon/lat/alt in IAU_SATURN) over the SOI window, where the spacecraft sweeps a wide range of
// body-fixed direction, so both the elevation floor and the azimuth mask have real crossings.
// The constant-floor case is cross-checked against an INDEPENDENT topocentric elevation: the
// angle of the site-to-Cassini vector above the local GEODETIC up at the facility, NOT the
// geocentric latitude of the Saturn-to-Cassini vector. The az-varying case raises the floor only
// over the azimuth sector the spacecraft crosses at its peak elevation, so it blocks a pass that
// the same constant lower floor admits. (STK_PARITY_SPEC §4.3, ACC az-el mask.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine, type Vec3 } from '@bessel/spice';
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
// A real facility on Saturn at a chosen geodetic site, NOT the body center: the geocentric
// latitude of the Saturn-to-Cassini vector would be wrong here, so the test validates the
// topocentric elevation at this off-center site.
const FACILITY: Facility = {
  body: 'SATURN',
  bodyFrame: 'IAU_SATURN',
  lonRad: (40 * Math.PI) / 180,
  latRad: (25 * Math.PI) / 180,
  altKm: 100,
};

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (a: Vec3): Vec3 => {
  const m = Math.sqrt(dot(a, a)) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

describe('@bessel/access azElMask constraint', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;
  // The facility's body-fixed position and topocentric triad, built independently as the oracle.
  let facPos: Vec3;
  let up: Vec3;
  let east: Vec3;
  let north: Vec3;

  // Independent TOPOCENTRIC elevation (rad) of the site-to-Cassini vector: the angle of the line
  // of sight above the local geodetic horizon, asin(los . up). This is what the constant floor
  // must reproduce, NOT asin(z / |r|) geocentric latitude.
  const topoElevationRad = async (et: number): Promise<number> => {
    const p = (await spice.spkpos(CASSINI, et, 'IAU_SATURN', 'NONE', 'SATURN')).position;
    const los = unit(sub(p, facPos));
    return Math.asin(Math.max(-1, Math.min(1, dot(los, up))));
  };
  // Independent TOPOCENTRIC azimuth (rad), measured from local north toward east.
  const topoAzimuthRad = async (et: number): Promise<number> => {
    const p = (await spice.spkpos(CASSINI, et, 'IAU_SATURN', 'NONE', 'SATURN')).position;
    const los = unit(sub(p, facPos));
    return Math.atan2(dot(los, east), dot(los, north));
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');

    // Build the facility's body-fixed position and topocentric triad from Saturn's radii, the
    // same geodetic ellipsoid math the access engine uses, but here as the independent oracle.
    const radii = await spice.bodvrd('SATURN', 'RADII');
    const re = radii[0]!;
    const rp = radii[2]!;
    const f = (re - rp) / re;
    const e2 = f * (2 - f);
    const sLat = Math.sin(FACILITY.latRad);
    const cLat = Math.cos(FACILITY.latRad);
    const n = re / Math.sqrt(1 - e2 * sLat * sLat);
    facPos = {
      x: (n + FACILITY.altKm) * cLat * Math.cos(FACILITY.lonRad),
      y: (n + FACILITY.altKm) * cLat * Math.sin(FACILITY.lonRad),
      z: (n * (1 - e2) + FACILITY.altKm) * sLat,
    };
    up = { x: cLat * Math.cos(FACILITY.lonRad), y: cLat * Math.sin(FACILITY.lonRad), z: sLat };
    east = unit(cross({ x: 0, y: 0, z: 1 }, up));
    north = cross(up, east);
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

  it('interpolateMaskFloor handles a wrap-around table (vertices near +pi and -pi)', () => {
    // A table whose vertices straddle the +-pi seam: one just below +pi, one just above -pi.
    const mask: MaskPoint[] = [
      { azimuthRad: -Math.PI + 0.1, minElevationRad: 0.2 },
      { azimuthRad: 0, minElevationRad: 0.5 },
      { azimuthRad: Math.PI - 0.1, minElevationRad: 0.8 },
    ];
    // The wrap segment runs from the +pi-0.1 vertex (0.8) to the -pi+0.1 vertex (0.2), symmetric
    // about the +-pi seam, so at exactly +-pi the floor is the midpoint 0.5.
    expect(interpolateMaskFloor(mask, Math.PI)).toBeCloseTo(0.5, 12);
    expect(interpolateMaskFloor(mask, -Math.PI)).toBeCloseTo(0.5, 12);
    // An interior query interpolates the right segment (the +pi-0.1 -> -pi+0.1 wrap, querying
    // just inside the +pi end stays high, near 0.8).
    expect(interpolateMaskFloor(mask, Math.PI - 0.05)).toBeGreaterThan(0.6);
  });

  it('interpolateMaskFloor tolerates duplicate-azimuth vertices', () => {
    // A duplicate vertex (a vertical step in the skyline) must not divide by zero or misbracket.
    const mask: MaskPoint[] = [
      { azimuthRad: 0, minElevationRad: 0 },
      { azimuthRad: Math.PI / 2, minElevationRad: 0.3 },
      { azimuthRad: Math.PI / 2, minElevationRad: 0.9 },
      { azimuthRad: Math.PI, minElevationRad: 0.4 },
    ];
    // Before the duplicate: interpolate 0 -> 0.3 over [0, pi/2]; at pi/4 the floor is 0.15.
    expect(interpolateMaskFloor(mask, Math.PI / 4)).toBeCloseTo(0.15, 12);
    // After the duplicate: interpolate 0.9 -> 0.4 over [pi/2, pi]; at 3pi/4 the floor is 0.65.
    expect(interpolateMaskFloor(mask, (3 * Math.PI) / 4)).toBeCloseTo(0.65, 12);
    expect(Number.isFinite(interpolateMaskFloor(mask, Math.PI / 2))).toBe(true);
  });

  it('constant floor: window edges sit at the independent TOPOCENTRIC elevation floor', async () => {
    // Pick a floor the topocentric elevation actually crosses over the span, so there are
    // interior edges. The facility is off-center, so this elevation is the geodetic-up angle.
    const samples = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((h) => topoElevationRad(t0 + h * 3600)));
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
        expect(await topoElevationRad(b)).toBeCloseTo(minElevationRad, 4);
      }
    }
  });

  it('an azimuth-varying mask blocks a peak-elevation pass a constant lower floor admits', async () => {
    // Find the spacecraft's peak TOPOCENTRIC elevation and its topocentric azimuth there. The
    // azimuth is measured from local north toward east at the facility, the same convention the
    // mask uses, so the blocked sector lines up with the peak.
    let peakEt = t0;
    let peakEl = -Infinity;
    for (let i = 0; i <= 72; i++) {
      const et = t0 + (i / 72) * (t1 - t0);
      const el = await topoElevationRad(et);
      if (el > peakEl) {
        peakEl = el;
        peakEt = et;
      }
    }
    const peakAz = await topoAzimuthRad(peakEt);

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
