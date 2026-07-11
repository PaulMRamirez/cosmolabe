// Shared orientation helper: convert a SPICE row-major 3x3 rotation (pxform) into
// a three.js Matrix4 (column-major). Used by DSK meshes, axis triads, rings, and
// spacecraft attitude (CK).

import { Matrix4, Quaternion, type Object3D } from 'three';

/** Convert a row-major 3x3 (SPICE pxform) to a three.js Matrix4. */
export function rowMajor3x3ToMatrix4(m: readonly number[]): Matrix4 {
  // three.js Matrix4.set takes row-major arguments, so pass the 3x3 directly into
  // the upper-left block with a 1 in the lower-right.
  return new Matrix4().set(
    m[0]!, m[1]!, m[2]!, 0,
    m[3]!, m[4]!, m[5]!, 0,
    m[6]!, m[7]!, m[8]!, 0,
    0, 0, 0, 1,
  );
}

/**
 * Orient an object by a SPICE row-major 3x3 rotation (item 3, CK attitude): the
 * spacecraft-body-to-inertial rotation from pxform(scFrame, J2000) becomes the
 * object's world orientation, so a loaded CK drives the model's attitude.
 */
export function applyAttitude(object: Object3D, rotationRowMajor3x3: readonly number[]): void {
  const q = new Quaternion().setFromRotationMatrix(rowMajor3x3ToMatrix4(rotationRowMajor3x3));
  object.quaternion.copy(q);
}

/** A SPICE row-major 3x3 rotation as a quaternion [x, y, z, w] (for state readout). */
export function rowMajor3x3ToQuaternion(
  rotationRowMajor3x3: readonly number[],
): [number, number, number, number] {
  const q = new Quaternion().setFromRotationMatrix(rowMajor3x3ToMatrix4(rotationRowMajor3x3));
  return [q.x, q.y, q.z, q.w];
}

/** Orient an object by a quaternion [x, y, z, w] (a Fixed catalog orientation). */
export function applyQuaternion(
  object: Object3D,
  quaternion: readonly [number, number, number, number],
): void {
  object.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]).normalize();
}

/**
 * Quaternion for a uniform spin about an axis (a UniformRotation orientation):
 * angle = ratePerSec * (et - epoch). Returns [x, y, z, w]; a degenerate axis
 * yields the identity rotation.
 */
export function uniformRotationQuaternion(
  axis: readonly [number, number, number],
  ratePerSec: number,
  et: number,
  epoch: number,
): [number, number, number, number] {
  const m = Math.hypot(axis[0], axis[1], axis[2]);
  if (m < 1e-12) return [0, 0, 0, 1];
  const angle = ratePerSec * (et - epoch);
  const half = angle / 2;
  const s = Math.sin(half) / m;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}
