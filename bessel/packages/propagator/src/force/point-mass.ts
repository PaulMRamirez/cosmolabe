// Point-mass (Keplerian) central gravity: a = -gm * r / |r|^3. With this term alone,
// the Cowell integrator must reproduce CSPICE prop2b to sub-meter (the primary
// self-contained validation oracle). (STK_PARITY_SPEC §4.2.)

import type { AccelPartials, ForceContext, ForceTerm, Mat3, Vector3 } from './types.ts';

export function pointMass(gm: number): ForceTerm {
  return {
    name: 'pointMass',
    acceleration(ctx: ForceContext): Vector3 {
      const [x, y, z] = ctx.r;
      const r2 = x * x + y * y + z * z;
      const r = Math.sqrt(r2);
      const k = -gm / (r2 * r); // -gm / r^3
      return [k * x, k * y, k * z];
    },
    // da/dr = -gm/r^3 (I - 3 r r^T / r^2). Closed form, exact (no FD), the STM seam.
    partials(ctx: ForceContext): AccelPartials {
      const [x, y, z] = ctx.r;
      const r2 = x * x + y * y + z * z;
      const r = Math.sqrt(r2);
      const c = -gm / (r2 * r); // -gm / r^3
      const d = 3 / r2;
      const dadr: Mat3 = [
        c * (1 - d * x * x), c * (-d * x * y), c * (-d * x * z),
        c * (-d * y * x), c * (1 - d * y * y), c * (-d * y * z),
        c * (-d * z * x), c * (-d * z * y), c * (1 - d * z * z),
      ];
      return { dadr };
    },
  };
}
