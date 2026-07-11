// Projections validated against EPSG:3857 reference points and forward/inverse
// round-trips. (STK_PARITY_SPEC §4.12.)

import { describe, it, expect } from 'vitest';
import {
  EARTH_RADIUS_M,
  WEB_MERCATOR_MAX_LAT,
  equirectangularForward,
  equirectangularInverse,
  webMercatorForward,
  webMercatorInverse,
  polarStereographicForward,
  polarStereographicInverse,
  type LonLat,
} from './index.ts';

const DEG = Math.PI / 180;

describe('webMercator', () => {
  it('matches EPSG:3857 reference extents', () => {
    // (0,0) -> (0,0); lon=180deg -> x = R*pi (the world half-width).
    const origin = webMercatorForward({ lon: 0, lat: 0 });
    expect(origin.x).toBe(0);
    expect(origin.y).toBeCloseTo(0, 6);
    const east = webMercatorForward({ lon: Math.PI, lat: 0 });
    expect(east.x).toBeCloseTo(20037508.342789244, 3);
    // At the max latitude the map is square: y == x at lon=180.
    const corner = webMercatorForward({ lon: Math.PI, lat: WEB_MERCATOR_MAX_LAT });
    expect(corner.y).toBeCloseTo(east.x, 3);
  });

  it('x is linear in longitude (a degree of longitude is a fixed width)', () => {
    const oneDeg = webMercatorForward({ lon: 1 * DEG, lat: 0 }).x;
    expect(oneDeg).toBeCloseTo(EARTH_RADIUS_M * DEG, 6);
    expect(webMercatorForward({ lon: 10 * DEG, lat: 30 * DEG }).x).toBeCloseTo(10 * oneDeg, 6);
  });

  it('round-trips longitude/latitude', () => {
    const ll: LonLat = { lon: 0.7, lat: -0.4 };
    const back = webMercatorInverse(webMercatorForward(ll));
    expect(back.lon).toBeCloseTo(ll.lon, 9);
    expect(back.lat).toBeCloseTo(ll.lat, 9);
  });
});

describe('equirectangular', () => {
  it('round-trips a dense grid', () => {
    for (const lon of [-3, -1, 0, 1, 3]) {
      for (const lat of [-1.5, -0.5, 0, 0.5, 1.5]) {
        const back = equirectangularInverse(equirectangularForward({ lon: lon * 0.3, lat: lat * 0.3 }));
        expect(back.lon).toBeCloseTo(lon * 0.3, 9);
        expect(back.lat).toBeCloseTo(lat * 0.3, 9);
      }
    }
    expect(equirectangularForward({ lon: Math.PI, lat: 0 }).x).toBeCloseTo(EARTH_RADIUS_M * Math.PI, 3);
  });
});

describe('polarStereographic', () => {
  it('places the pole at the origin and round-trips', () => {
    expect(polarStereographicForward({ lon: 1.2, lat: Math.PI / 2 })).toEqual({ x: 0, y: -0 });
    const ll: LonLat = { lon: 0.5, lat: 1.2 };
    const back = polarStereographicInverse(polarStereographicForward(ll));
    expect(back.lon).toBeCloseTo(ll.lon, 9);
    expect(back.lat).toBeCloseTo(ll.lat, 9);
  });
});
