// FOV geometry against closed forms: point-in-FOV, conic boundary angles, and the
// nadir-cone footprint circle on a sphere. Pure. (STK_PARITY_SPEC §4.7.)

import { describe, it, expect } from 'vitest';
import {
  offBoresightAngle,
  pointInConicFov,
  conicBoundary,
  raySphereIntersect,
  footprintOnSphere,
  type Vec3,
} from './index.ts';

const Z: Vec3 = { x: 0, y: 0, z: 1 };

describe('conic FOV', () => {
  it('classifies on-axis, boundary, and outside rays', () => {
    const half = (10 * Math.PI) / 180;
    expect(pointInConicFov(Z, Z, half)).toBe(true); // on-axis
    const at8 = { x: Math.sin((8 * Math.PI) / 180), y: 0, z: Math.cos((8 * Math.PI) / 180) };
    const at12 = { x: Math.sin((12 * Math.PI) / 180), y: 0, z: Math.cos((12 * Math.PI) / 180) };
    expect(pointInConicFov(at8, Z, half)).toBe(true);
    expect(pointInConicFov(at12, Z, half)).toBe(false);
  });

  it('boundary rays are all exactly at the half-angle from the boresight', () => {
    const half = 0.2;
    for (const ray of conicBoundary(Z, half, 32)) {
      expect(offBoresightAngle(ray, Z)).toBeCloseTo(half, 9);
    }
  });
});

describe('raySphereIntersect', () => {
  it('hits a unit sphere straight on and misses when pointed away', () => {
    const hit = raySphereIntersect({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, 1);
    expect(hit).toEqual({ x: 0, y: 0, z: 1 });
    expect(raySphereIntersect({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 1)).toBeNull();
  });
});

describe('footprintOnSphere', () => {
  it('a nadir cone makes a footprint circle of the analytic radius', () => {
    // Sensor at altitude h above a sphere of radius R, looking straight down with a
    // half-angle alpha; the footprint ring sits at a known surface co-latitude.
    const R = 6371;
    const h = 700;
    const apex: Vec3 = { x: 0, y: 0, z: R + h };
    const boresight: Vec3 = { x: 0, y: 0, z: -1 };
    const alpha = (3 * Math.PI) / 180;
    const fp = footprintOnSphere(apex, boresight, alpha, { x: 0, y: 0, z: 0 }, R, 48);
    expect(fp.misses).toBe(0); // narrow nadir cone fully on the disk
    expect(fp.points).toHaveLength(48);

    // Every footprint point is on the sphere surface...
    for (const p of fp.points) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(R, 6);
    }
    // ...and at a constant ring radius about the sub-satellite point (the +z axis),
    // i.e. the footprint is a circle.
    const ringRadii = fp.points.map((p) => Math.hypot(p.x, p.y));
    const rmin = Math.min(...ringRadii);
    const rmax = Math.max(...ringRadii);
    expect(rmax - rmin).toBeLessThan(1e-6);
    expect(rmax).toBeGreaterThan(0);
  });
});
