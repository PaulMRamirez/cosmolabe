// State Transition Matrix via the variational equations. Augment the 6-state Cartesian
// vector with the 36 entries of Phi (row-major), giving a 42-state ODE whose extra
// rows are dPhi/dt = A(t) Phi, with the Jacobian of the equations of motion
//
//   A = [ 0   I  ]      (top: dr/dt = v;  bottom: dv/dt = a(r, v))
//       [ dadr dadv ]
//
// da/dr (and da/dv when present) come from the force model's partials() seam: analytic
// for point-mass and third-body, central-differenced for zonal. Integrating the
// augmented state through the SAME DOPRI5 stepper yields Phi(t, t0) consistent with the
// trajectory to integrator tolerance. The STM is the linear sensitivity the
// differential corrector (MCS targeting) consumes. (STK_PARITY_SPEC §4.2.)

import type { Rhs } from './integrator.ts';
import type { ForceModel } from './force/types.ts';

/** State dimension of the augmented (state + STM) system: 6 + 36. */
export const STM_DIM = 42;

/**
 * Build the 42-vector [r, v, vec(I_6)] from a 6-state: the STM is seeded to identity
 * because Phi(t0, t0) = I.
 */
export function augmentInitialState(state6: Float64Array | readonly number[]): Float64Array {
  if (state6.length !== 6) throw new RangeError(`augmentInitialState expects a 6-state (got ${state6.length})`);
  const y = new Float64Array(STM_DIM);
  for (let i = 0; i < 6; i++) y[i] = state6[i]!;
  for (let i = 0; i < 6; i++) y[6 + i * 6 + i] = 1; // identity Phi
  return y;
}

/**
 * Right-hand side of the augmented (state + STM) system for `model`. Fills dy[0..5]
 * with [v, a] and dy[6..41] with A Phi. Alloc-free after construction (one Mat3 read
 * per call). When `fdFallback` (default) a term lacking analytic partials is
 * central-differenced; pass false to force StmUnsupportedError instead.
 */
export function makeStmRhs(model: ForceModel, fdFallback = true): Rhs {
  return (t, y, dy) => {
    const r: readonly [number, number, number] = [y[0]!, y[1]!, y[2]!];
    const v: readonly [number, number, number] = [y[3]!, y[4]!, y[5]!];
    const ctx = { et: t, r, v };
    const a = model.acceleration(ctx);
    dy[0] = y[3]!;
    dy[1] = y[4]!;
    dy[2] = y[5]!;
    dy[3] = a[0];
    dy[4] = a[1];
    dy[5] = a[2];

    const p = model.partials(ctx, fdFallback);
    const dadr = p.dadr;
    const dadv = p.dadv; // may be undefined (no velocity-dependent term)

    // dPhi/dt = A Phi, Phi row-major in y[6 + row*6 + col].
    for (let col = 0; col < 6; col++) {
      // Top three rows: (A Phi)[i][col] = Phi[i+3][col].
      dy[6 + 0 * 6 + col] = y[6 + 3 * 6 + col]!;
      dy[6 + 1 * 6 + col] = y[6 + 4 * 6 + col]!;
      dy[6 + 2 * 6 + col] = y[6 + 5 * 6 + col]!;
      // Bottom three rows a=0..2: sum_b dadr[a][b] Phi[b][col] + dadv[a][b] Phi[3+b][col].
      for (let a3 = 0; a3 < 3; a3++) {
        let acc =
          dadr[a3 * 3 + 0]! * y[6 + 0 * 6 + col]! +
          dadr[a3 * 3 + 1]! * y[6 + 1 * 6 + col]! +
          dadr[a3 * 3 + 2]! * y[6 + 2 * 6 + col]!;
        if (dadv) {
          acc +=
            dadv[a3 * 3 + 0]! * y[6 + 3 * 6 + col]! +
            dadv[a3 * 3 + 1]! * y[6 + 4 * 6 + col]! +
            dadv[a3 * 3 + 2]! * y[6 + 5 * 6 + col]!;
        }
        dy[6 + (3 + a3) * 6 + col] = acc;
      }
    }
  };
}

/** Extract the 6x6 STM (row-major Float64Array of length 36) from a 42-state. */
export function stmFromState(y42: Float64Array): Float64Array {
  if (y42.length !== STM_DIM) throw new RangeError(`stmFromState expects a ${STM_DIM}-state (got ${y42.length})`);
  return y42.slice(6, 42);
}
