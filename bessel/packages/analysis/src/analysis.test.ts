// Vector Geometry Tool against closed forms, and the time-series sampler/stats.
// (STK_PARITY_SPEC §4.10.)

import { describe, it, expect } from 'vitest';
import {
  angleBetween,
  signedAngleAbout,
  projection,
  rejection,
  vectorToPlaneAngle,
  sampleSeries,
  seriesStats,
} from './index.ts';

const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };

describe('vector geometry', () => {
  it('angleBetween is pi/2 for orthogonal vectors and 0 for parallel', () => {
    expect(angleBetween(X, Y)).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetween(X, { x: 5, y: 0, z: 0 })).toBeCloseTo(0, 12);
    expect(angleBetween(X, { x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI, 12);
  });

  it('signedAngleAbout has the right handedness', () => {
    expect(signedAngleAbout(X, Y, Z)).toBeCloseTo(Math.PI / 2, 12); // +x to +y about +z is +90
    expect(signedAngleAbout(Y, X, Z)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('projection and rejection split a vector', () => {
    const v = { x: 3, y: 4, z: 0 };
    expect(projection(v, X)).toBeCloseTo(3, 12);
    const r = rejection(v, X);
    expect(r).toEqual({ x: 0, y: 4, z: 0 });
  });

  it('vectorToPlaneAngle is the elevation above the plane', () => {
    // 45 deg above the XY plane (normal +Z).
    expect(vectorToPlaneAngle({ x: 1, y: 0, z: 1 }, Z)).toBeCloseTo(Math.PI / 4, 12);
    expect(vectorToPlaneAngle(X, Z)).toBeCloseTo(0, 12); // in-plane
  });
});

describe('time series', () => {
  it('samples a provider and reduces to statistics', () => {
    const grid = Float64Array.from({ length: 5 }, (_, k) => k);
    const s = sampleSeries('linear', (et) => 2 * et + 1, grid);
    expect([...s.value]).toEqual([1, 3, 5, 7, 9]);
    const stats = seriesStats(s);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(9);
    expect(stats.mean).toBe(5);
  });
});
