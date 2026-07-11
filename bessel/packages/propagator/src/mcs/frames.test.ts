// The VNB maneuver frame: an orthonormal right-handed triad, and a delta-v rotation that
// preserves magnitude and reduces to identity for an inertial burn. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { vnbBasis, dvToInertial, vnbAxisToInertial } from './frames.ts';
import { DegenerateGeometryError } from './errors.ts';
import type { Vec3 } from '@bessel/spice';

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mag = (a: Vec3): number => Math.sqrt(dot(a, a));

// A circular orbit state: r along x, v along y.
const R: Vec3 = { x: 7000, y: 0, z: 0 };
const V: Vec3 = { x: 0, y: 7.546, z: 0 };

describe('VNB basis', () => {
  it('is orthonormal and right-handed', () => {
    const { vHat, nHat, bHat } = vnbBasis(R, V);
    expect(mag(vHat)).toBeCloseTo(1, 12);
    expect(mag(nHat)).toBeCloseTo(1, 12);
    expect(mag(bHat)).toBeCloseTo(1, 12);
    expect(dot(vHat, nHat)).toBeCloseTo(0, 12);
    expect(dot(vHat, bHat)).toBeCloseTo(0, 12);
    expect(dot(nHat, bHat)).toBeCloseTo(0, 12);
    // V x N = B (right-handed).
    const cx = vHat.y * nHat.z - vHat.z * nHat.y;
    const cy = vHat.z * nHat.x - vHat.x * nHat.z;
    const cz = vHat.x * nHat.y - vHat.y * nHat.x;
    expect(cx).toBeCloseTo(bHat.x, 12);
    expect(cy).toBeCloseTo(bHat.y, 12);
    expect(cz).toBeCloseTo(bHat.z, 12);
  });

  it('throws on a rectilinear (zero angular momentum) state', () => {
    expect(() => vnbBasis({ x: 7000, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })).toThrow(DegenerateGeometryError);
  });

  it('throws on a zero-velocity state', () => {
    expect(() => vnbBasis(R, { x: 0, y: 0, z: 0 })).toThrow(DegenerateGeometryError);
  });
});

describe('delta-v rotation', () => {
  it('maps a prograde VNB burn along the velocity direction', () => {
    const dvI = dvToInertial('VNB', { x: 0.1, y: 0, z: 0 }, R, V);
    expect(dvI.x).toBeCloseTo(0, 12);
    expect(dvI.y).toBeCloseTo(0.1, 12); // along +y (velocity)
    expect(dvI.z).toBeCloseTo(0, 12);
    expect(mag(dvI)).toBeCloseTo(0.1, 12); // magnitude preserved
  });

  it('passes an inertial burn through unchanged', () => {
    const dv = { x: 0.03, y: -0.02, z: 0.01 };
    expect(dvToInertial('Inertial', dv, R, V)).toEqual(dv);
  });

  it('vnbAxisToInertial returns the matching basis column', () => {
    const { vHat } = vnbBasis(R, V);
    expect(vnbAxisToInertial('VNB', 'x', R, V)).toEqual(vHat);
    expect(vnbAxisToInertial('Inertial', 'z', R, V)).toEqual({ x: 0, y: 0, z: 1 });
  });
});
