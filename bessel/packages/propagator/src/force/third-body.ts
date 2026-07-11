// Third-body (point-mass) perturbation in the central-body-centered frame:
//   a = gm_b * ( (s - r)/|s - r|^3  -  s/|s|^3 )
// where s is the third body relative to the central body and r is the satellite. The
// second (indirect) term is the acceleration of the central body by the third body
// and is what makes the equation valid in the non-inertial central-body frame; it is
// the most commonly omitted term. The third-body position is resolved up front into a
// synchronous interpolator (the integrator never awaits). Parity vs a reference
// trajectory is deferred (no committed fixture); only geometric sanity is asserted.
// (STK_PARITY_SPEC §4.2.)

import type { AccelPartials, ForceTerm, Mat3, Vector3 } from './types.ts';

/** A synchronous third-body position (km, relative to the central body) at an epoch. */
export type PositionAt = (et: number) => Vector3;

export function thirdBody(name: string, gm: number, positionAt: PositionAt): ForceTerm {
  return {
    name: `thirdBody:${name}`,
    acceleration(ctx): Vector3 {
      const s = positionAt(ctx.et);
      const [rx, ry, rz] = ctx.r;
      const dx = s[0] - rx;
      const dy = s[1] - ry;
      const dz = s[2] - rz;
      const d3 = (dx * dx + dy * dy + dz * dz) ** 1.5; // |s - r|^3
      const s3 = (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]) ** 1.5; // |s|^3
      return [
        gm * (dx / d3 - s[0] / s3),
        gm * (dy / d3 - s[1] / s3),
        gm * (dz / d3 - s[2] / s3),
      ];
    },
    // da/dr about the relative vector q = s - r: gm/|q|^3 (3 q q^T/|q|^2 - I). The
    // indirect (-gm s/|s|^3) term is constant in r and drops out. Exact, no FD.
    partials(ctx): AccelPartials {
      const s = positionAt(ctx.et);
      const [rx, ry, rz] = ctx.r;
      const qx = s[0] - rx;
      const qy = s[1] - ry;
      const qz = s[2] - rz;
      const q2 = qx * qx + qy * qy + qz * qz;
      const q = Math.sqrt(q2);
      const c = -gm / (q2 * q); // d(gm q/|q|^3)/dr carries -gm/|q|^3 from dq/dr = -I
      const d = 3 / q2;
      const dadr: Mat3 = [
        c * (1 - d * qx * qx), c * (-d * qx * qy), c * (-d * qx * qz),
        c * (-d * qy * qx), c * (1 - d * qy * qy), c * (-d * qy * qz),
        c * (-d * qz * qx), c * (-d * qz * qy), c * (1 - d * qz * qz),
      ];
      return { dadr };
    },
  };
}

/**
 * Build a synchronous linear interpolator over a sampled third-body ephemeris. `et`
 * is the sample grid (ascending); `posFlat` is n*3 interleaved positions (km). Out-of
 * range epochs clamp to the endpoints (the integrator stays within the grid).
 */
export function sampledPosition(et: Float64Array, posFlat: Float64Array): PositionAt {
  const n = et.length;
  return (q: number): Vector3 => {
    if (q <= et[0]!) return [posFlat[0]!, posFlat[1]!, posFlat[2]!];
    if (q >= et[n - 1]!) return [posFlat[3 * (n - 1)]!, posFlat[3 * (n - 1) + 1]!, posFlat[3 * (n - 1) + 2]!];
    // Binary search for the bracketing interval.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (et[mid]! <= q) lo = mid;
      else hi = mid;
    }
    const t0 = et[lo]!;
    const t1 = et[hi]!;
    const f = (q - t0) / (t1 - t0);
    const i0 = 3 * lo;
    const i1 = 3 * hi;
    return [
      posFlat[i0]! + f * (posFlat[i1]! - posFlat[i0]!),
      posFlat[i0 + 1]! + f * (posFlat[i1 + 1]! - posFlat[i0 + 1]!),
      posFlat[i0 + 2]! + f * (posFlat[i1 + 2]! - posFlat[i0 + 2]!),
    ];
  };
}
