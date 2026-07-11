// Minimal row-major 3x3 matrix and 3-vector algebra for the frame transforms. Kept
// local to the frames module so the precession/nutation/TEME code stays self-contained
// and dependency-free (it reuses the Mat3 row-major tuple from the force model). The
// elementary rotations follow Vallado's convention: ROT1/ROT3 rotate the coordinate
// axes (passive), so r_new = ROTk(angle) * r_old. (STK_PARITY_SPEC frames.)

import type { Mat3 } from '../force/types.ts';

export type Vec3 = readonly [number, number, number];

/** Row-major 3x3 multiply: returns a*b. */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!;
  const a3 = a[3]!, a4 = a[4]!, a5 = a[5]!;
  const a6 = a[6]!, a7 = a[7]!, a8 = a[8]!;
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!;
  const b3 = b[3]!, b4 = b[4]!, b5 = b[5]!;
  const b6 = b[6]!, b7 = b[7]!, b8 = b[8]!;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

/** Apply a row-major matrix to a column vector: returns m*v. */
export function matVec(m: Mat3, v: Vec3): [number, number, number] {
  const x = v[0]!, y = v[1]!, z = v[2]!;
  return [
    m[0]! * x + m[1]! * y + m[2]! * z,
    m[3]! * x + m[4]! * y + m[5]! * z,
    m[6]! * x + m[7]! * y + m[8]! * z,
  ];
}

/** Transpose (and hence invert, for orthonormal matrices) a row-major 3x3. */
export function transpose(m: Mat3): Mat3 {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Elementary axis rotation about the x-axis (Vallado ROT1), passive: r_new = ROT1(a) r.
 *   [ 1     0      0   ]
 *   [ 0   cos a  sin a ]
 *   [ 0  -sin a  cos a ]
 */
export function rot1(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/**
 * Elementary axis rotation about the z-axis (Vallado ROT3), passive: r_new = ROT3(a) r.
 *   [  cos a  sin a  0 ]
 *   [ -sin a  cos a  0 ]
 *   [   0      0     1 ]
 */
export function rot3(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
