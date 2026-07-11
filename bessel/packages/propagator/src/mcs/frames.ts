// The VNB (velocity, normal, bi-normal) maneuver frame and delta-v rotation. A burn is
// authored in VNB (prograde/cross-track/radial-ish) or directly in the inertial frame;
// both reduce to an inertial delta-v the integrator can apply. vnbAxisToInertial returns
// a single basis column, the seed the STM-analytic Jacobian perturbs. (STK_PARITY_SPEC §4.3.)

import type { Vec3 } from '@bessel/spice';
import { DegenerateGeometryError } from './errors.ts';

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mag = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export interface VnbBasis {
  readonly vHat: Vec3; // along velocity
  readonly nHat: Vec3; // orbit normal (r x v)
  readonly bHat: Vec3; // bi-normal, completes the right-handed triad (V x N)
}

/** Orthonormal VNB basis at a state; throws on a degenerate (zero-v or rectilinear) state. */
export function vnbBasis(r: Vec3, v: Vec3): VnbBasis {
  const vm = mag(v);
  if (vm < 1e-12) throw new DegenerateGeometryError([], 'zero velocity, VNB undefined');
  const h = cross(r, v);
  const hm = mag(h);
  if (hm < 1e-12) throw new DegenerateGeometryError([], 'rectilinear motion, orbit normal undefined');
  const vHat = scale(v, 1 / vm);
  const nHat = scale(h, 1 / hm);
  const bHat = cross(vHat, nHat);
  return { vHat, nHat, bHat };
}

/** Rotate a delta-v from its authored frame into inertial coordinates. */
export function dvToInertial(attitude: 'VNB' | 'Inertial', dv: Vec3, r: Vec3, v: Vec3): Vec3 {
  if (attitude === 'Inertial') return dv;
  const { vHat, nHat, bHat } = vnbBasis(r, v);
  return {
    x: dv.x * vHat.x + dv.y * nHat.x + dv.z * bHat.x,
    y: dv.x * vHat.y + dv.y * nHat.y + dv.z * bHat.y,
    z: dv.x * vHat.z + dv.y * nHat.z + dv.z * bHat.z,
  };
}

/** The unit inertial direction a single VNB (or inertial) delta-v axis perturbs. */
export function vnbAxisToInertial(attitude: 'VNB' | 'Inertial', axis: 'x' | 'y' | 'z', r: Vec3, v: Vec3): Vec3 {
  if (attitude === 'Inertial') {
    return { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 };
  }
  const basis = vnbBasis(r, v);
  return axis === 'x' ? basis.vHat : axis === 'y' ? basis.nHat : basis.bHat;
}
