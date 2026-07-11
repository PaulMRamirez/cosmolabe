// Item 3 (CK attitude): applyAttitude orients an object by a SPICE row-major 3x3
// rotation, so a pxform(scFrame, J2000) result drives the spacecraft model.

import { describe, it, expect } from 'vitest';
import { Object3D, Vector3 } from 'three';
import {
  applyAttitude,
  applyQuaternion,
  rowMajor3x3ToMatrix4,
  rowMajor3x3ToQuaternion,
  uniformRotationQuaternion,
} from './orientation.ts';

describe('applyAttitude', () => {
  it('leaves an object unrotated for the identity rotation', () => {
    const obj = new Object3D();
    applyAttitude(obj, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(obj.quaternion.x).toBeCloseTo(0, 6);
    expect(obj.quaternion.y).toBeCloseTo(0, 6);
    expect(obj.quaternion.z).toBeCloseTo(0, 6);
    expect(obj.quaternion.w).toBeCloseTo(1, 6);
  });

  it('rotates +x to +y for a 90 degree rotation about z', () => {
    const obj = new Object3D();
    // Row-major rotation of +90 degrees about z: x -> y, y -> -x.
    applyAttitude(obj, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
    obj.updateMatrix();
    const v = new Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('matches the Matrix4 built from the same rotation', () => {
    const rot = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    const obj = new Object3D();
    applyAttitude(obj, rot);
    const m = rowMajor3x3ToMatrix4(rot);
    const v1 = new Vector3(1, 2, 3).applyQuaternion(obj.quaternion);
    const v2 = new Vector3(1, 2, 3).applyMatrix4(m);
    expect(v1.x).toBeCloseTo(v2.x, 6);
    expect(v1.y).toBeCloseTo(v2.y, 6);
    expect(v1.z).toBeCloseTo(v2.z, 6);
  });
});

describe('rowMajor3x3ToQuaternion (state readout)', () => {
  it('returns the identity quaternion for the identity rotation', () => {
    expect(rowMajor3x3ToQuaternion([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([0, 0, 0, 1]);
  });

  it('agrees with applyAttitude for the same rotation', () => {
    const rot = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const q = rowMajor3x3ToQuaternion(rot);
    const obj = new Object3D();
    applyAttitude(obj, rot);
    expect(q[0]).toBeCloseTo(obj.quaternion.x, 6);
    expect(q[1]).toBeCloseTo(obj.quaternion.y, 6);
    expect(q[2]).toBeCloseTo(obj.quaternion.z, 6);
    expect(q[3]).toBeCloseTo(obj.quaternion.w, 6);
  });
});

describe('applyQuaternion (Fixed attitude)', () => {
  it('normalizes and applies a quaternion', () => {
    const obj = new Object3D();
    // 180 degrees about z (unnormalized): rotates +x to -x.
    applyQuaternion(obj, [0, 0, 2, 0]);
    const v = new Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
    expect(v.x).toBeCloseTo(-1, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });
});

describe('uniformRotationQuaternion (UniformRotation attitude)', () => {
  it('is the identity at the epoch', () => {
    expect(uniformRotationQuaternion([0, 1, 0], 0.5, 10, 10)).toEqual([0, 0, 0, 1]);
  });

  it('spins about the axis at the given rate', () => {
    // Pi/2 about +y after (et - epoch) * rate = (2)*（pi/4) seconds.
    const q = uniformRotationQuaternion([0, 1, 0], Math.PI / 4, 12, 10);
    const obj = new Object3D();
    applyQuaternion(obj, q);
    // +x rotates toward -z for a +90 degrees rotation about +y.
    const v = new Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(-1, 5);
  });

  it('returns the identity for a degenerate axis', () => {
    expect(uniformRotationQuaternion([0, 0, 0], 1, 5, 0)).toEqual([0, 0, 0, 1]);
  });
});
