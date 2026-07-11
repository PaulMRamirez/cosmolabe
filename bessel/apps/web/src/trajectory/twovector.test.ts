// TwoVector orientation (item 5 / backlog C18): resolveTwoVector must turn a primary
// and secondary reference direction into an orthonormal body-to-inertial rotation
// (and so a unit quaternion), with the primary body axis aligned to the primary
// direction and the secondary axis in the primary-secondary plane. Real CSPICE
// (twovec/m2q) with the fixture kernels, asserted by orthonormality and alignment,
// never by judgement.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { Quaternion } from 'three';
import { createSpiceEngine, type Mat3, type SpiceEngine } from '@bessel/spice';
import { rowMajor3x3ToQuaternion } from '@bessel/scene';
import { planTwoVector, resolveTwoVector, transpose3x3 } from './twovector.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

/** A row-major 3x3 column (the body axis the index selects in body-to-inertial form). */
function column(m: Mat3, axisIndex: 1 | 2 | 3): [number, number, number] {
  const c = axisIndex - 1;
  return [m[c]!, m[c + 3]!, m[c + 6]!];
}

function unit(v: readonly [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

/** Assert a row-major 3x3 is orthonormal with determinant +1 (a proper rotation). */
function expectOrthonormal(m: Mat3): void {
  const c1 = column(m, 1);
  const c2 = column(m, 2);
  const c3 = column(m, 3);
  for (const c of [c1, c2, c3]) expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 9);
  expect(dot(c1, c2)).toBeCloseTo(0, 9);
  expect(dot(c1, c3)).toBeCloseTo(0, 9);
  expect(dot(c2, c3)).toBeCloseTo(0, 9);
  // Right-handed: c1 x c2 == c3.
  const cross: [number, number, number] = [
    c1[1] * c2[2] - c1[2] * c2[1],
    c1[2] * c2[0] - c1[0] * c2[2],
    c1[0] * c2[1] - c1[1] * c2[0],
  ];
  expect(cross[0]).toBeCloseTo(c3[0], 9);
  expect(cross[1]).toBeCloseTo(c3[1], 9);
  expect(cross[2]).toBeCloseTo(c3[2], 9);
}

describe('resolveTwoVector', () => {
  let spice: SpiceEngine;
  let et: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    et = await spice.str2et('2004-07-01T00:00:00');
  });

  it('builds an orthonormal basis aligning the primary body axis with the primary direction', async () => {
    // A fixed-vector geometry is deterministic: primary +X along (1,1,0) (the array form
    // resolves to body axis X), secondary +Z constrained into the plane with (0,0,1).
    const spec = planTwoVector(
      {
        type: 'TwoVector',
        primary: { axis: [1, 1, 0] },
        secondary: { axis: [0, 0, 1] },
      },
      '-9100',
    );
    const rot = await resolveTwoVector(spice, spec, et);
    expectOrthonormal(rot);
    // The body +X axis (primary, index 1) points along the normalized primary direction.
    const bodyX = column(rot, 1);
    const expectedPrimary = unit([1, 1, 0]);
    expect(bodyX[0]).toBeCloseTo(expectedPrimary[0], 9);
    expect(bodyX[1]).toBeCloseTo(expectedPrimary[1], 9);
    expect(bodyX[2]).toBeCloseTo(expectedPrimary[2], 9);
    // The quaternion from the rotation is a unit quaternion.
    const q = rowMajor3x3ToQuaternion(rot);
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 9);
  });

  it('resolves a target direction (point +Z at Saturn) into a unit-quaternion attitude', async () => {
    // Body +Z toward Saturn (target direction), +X completing the frame with the Sun.
    const spec = planTwoVector(
      {
        type: 'TwoVector',
        primary: { axis: 'z' as const, target: '6' },
        secondary: { axis: 'x' as const, target: '10' },
      },
      '399',
    );
    const rot = await resolveTwoVector(spice, spec, et);
    expectOrthonormal(rot);
    // The body +Z axis points along the (observer -> Saturn) direction.
    const toSaturn = await spice.spkpos('6', et, 'J2000', 'NONE', '399');
    const expected = unit([toSaturn.position.x, toSaturn.position.y, toSaturn.position.z]);
    const bodyZ = column(rot, 3);
    expect(bodyZ[0]).toBeCloseTo(expected[0], 6);
    expect(bodyZ[1]).toBeCloseTo(expected[1], 6);
    expect(bodyZ[2]).toBeCloseTo(expected[2], 6);
    // Applying the quaternion to the body +Z axis yields the same J2000 direction.
    const q = rowMajor3x3ToQuaternion(rot);
    const quat = new Quaternion(q[0], q[1], q[2], q[3]);
    const v = { x: 0, y: 0, z: 1 };
    const rotated = applyQuat(quat, v);
    expect(rotated.x).toBeCloseTo(expected[0], 6);
    expect(rotated.y).toBeCloseTo(expected[1], 6);
    expect(rotated.z).toBeCloseTo(expected[2], 6);
  });

  it('fails loudly when a target direction cannot be resolved', async () => {
    const spec = planTwoVector(
      {
        type: 'TwoVector',
        primary: { axis: 'z' as const, target: 'NOT_A_BODY' },
        secondary: { axis: 'x' as const },
      },
      '399',
    );
    await expect(resolveTwoVector(spice, spec, et)).rejects.toThrow(/TwoVector orientation/);
  });

  it('rejects a malformed declaration at plan time (primary and secondary on the same axis)', () => {
    expect(() =>
      planTwoVector(
        { type: 'TwoVector', primary: { axis: 'x' as const }, secondary: { axis: 'x' as const } },
        '-9100',
      ),
    ).toThrow(/different body axes/);
  });

  it('transpose3x3 inverts a rotation (the inertial-to-body to body-to-inertial flip)', () => {
    const m = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const t = transpose3x3(m);
    expect(t).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
  });
});

/** Apply a three.js quaternion to a plain vector (avoids importing Vector3 churn). */
function applyQuat(q: Quaternion, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const { x, y, z } = v;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
