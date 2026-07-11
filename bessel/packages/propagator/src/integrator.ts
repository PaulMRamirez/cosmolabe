// An adaptive Dormand-Prince 5(4) ODE integrator (the DOPRI5 stepper). Generic over
// the state vector: it solves dy/dt = f(t, y) with embedded error control and a step
// controller, knowing nothing about orbits or SPICE. propagateCowell builds the
// orbit right-hand side and hands it here. Fails loudly on a step collapse or a
// non-finite derivative. (STK_PARITY_SPEC §4.2.)

import { A, B, C, E, STAGES } from './integrator-coeffs.ts';
import { IntegrationError } from './errors.ts';

/** Right-hand side: fill `dy` with dy/dt at (t, y). Must not allocate. */
export type Rhs = (t: number, y: Float64Array, dy: Float64Array) => void;

export interface IntegratorOptions {
  /** Relative tolerance per component (default 1e-11). */
  readonly rtol?: number;
  /** Absolute tolerance per component (default 1e-9). */
  readonly atol?: number;
  /** Max rejected attempts at one step before failing loudly (default 50). */
  readonly maxRejects?: number;
  /** Smallest allowed step (s) before failing loudly (default 1e-9). */
  readonly hMin?: number;
}

/**
 * Smallest error scale a component may have. The error scale is sc_i = atol + rtol*|y_i|; with
 * atol = 0 (a legal option) and an exactly-zero state component (y_i = 0), sc_i collapses to 0 and
 * the rmsNorm division v_i/sc_i yields Inf/NaN, which surfaces downstream as a misleading
 * "non-finite derivative" even though the derivative is finite. Floor sc to this tiny positive
 * value so a zero-scale component contributes a finite, well-defined error term.
 */
export const SC_FLOOR = 1e-300;

/** Error scale for one component: atol + rtol*|y|, floored to SC_FLOOR so it is never zero. */
export function errorScale(atol: number, rtol: number, absY: number): number {
  return Math.max(SC_FLOOR, atol + rtol * absY);
}

/** Root-mean-square norm of v_i / sc_i. */
export function rmsNorm(v: Float64Array, sc: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const e = v[i]! / sc[i]!;
    sum += e * e;
  }
  return Math.sqrt(sum / v.length);
}

/**
 * Smallest first step initialStep may return. A stiff start (large second-derivative norm d2)
 * drives Hairer's h1 = (0.01/maxD)^(1/5) arbitrarily small, which can seed the stepper with an
 * unusably tiny step (or, with d2 ~ 1/0, a zero/NaN one) that immediately trips the step-collapse
 * guard. Floor the returned step to this small POSITIVE value so the adaptive controller can grow
 * it; it stays well below the integrator's hMin-driven collapse threshold so genuine stiffness is
 * still caught on rejection, not hidden.
 */
const INITIAL_STEP_FLOOR = 1e-8;

/** Hairer's automatic initial step selection (Solving ODE I, II.4). */
export function initialStep(rhs: Rhs, t0: number, y0: Float64Array, f0: Float64Array, sc: Float64Array): number {
  const n = y0.length;
  const d0 = rmsNorm(y0, sc);
  const d1 = rmsNorm(f0, sc);
  const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * (d0 / d1);
  const y1 = new Float64Array(n);
  for (let i = 0; i < n; i++) y1[i] = y0[i]! + h0 * f0[i]!;
  const f1 = new Float64Array(n);
  rhs(t0 + h0, y1, f1);
  const df = new Float64Array(n);
  for (let i = 0; i < n; i++) df[i] = f1[i]! - f0[i]!;
  const d2 = rmsNorm(df, sc) / h0;
  const maxD = Math.max(d1, d2);
  const h1 = maxD <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / maxD) ** (1 / 5);
  return Math.max(INITIAL_STEP_FLOOR, Math.min(100 * h0, h1));
}

/**
 * Integrate dy/dt = f(t, y) from `t0` (state `y0`) and sample the solution at each
 * epoch in `tGrid` (ascending, all >= t0). Returns one state vector per grid epoch.
 */
export function integrate(
  rhs: Rhs,
  y0: Float64Array,
  t0: number,
  tGrid: Float64Array,
  opts: IntegratorOptions = {},
): Float64Array[] {
  const n = y0.length;
  const rtol = opts.rtol ?? 1e-11;
  const atol = opts.atol ?? 1e-9;
  const maxRejects = opts.maxRejects ?? 50;
  const hMin = opts.hMin ?? 1e-9;

  const k: Float64Array[] = Array.from({ length: STAGES }, () => new Float64Array(n));
  const ytmp = new Float64Array(n);
  const y5 = new Float64Array(n);
  const sc = new Float64Array(n);
  const errVec = new Float64Array(n);

  let t = t0;
  const y = Float64Array.from(y0);

  // Initial step from the derivative at the start.
  rhs(t, y, k[0]!);
  for (let i = 0; i < n; i++) sc[i] = errorScale(atol, rtol, Math.abs(y[i]!));
  let h = initialStep(rhs, t, y, k[0]!, sc);

  const out: Float64Array[] = [];
  for (const target of tGrid) {
    if (target < t - 1e-9) throw new IntegrationError(`tGrid must be ascending and >= epoch (got ${target} < ${t})`);
    while (t < target - 1e-9) {
      let rejects = 0;
      for (;;) {
        const hStep = Math.min(h, target - t); // clamp so a step lands on the grid epoch
        // Stage 1 (recomputed each step; no FSAL, for a smaller bug surface).
        rhs(t, y, k[0]!);
        for (let s = 1; s < STAGES; s++) {
          for (let i = 0; i < n; i++) {
            let acc = 0;
            const row = A[s]!;
            for (let j = 0; j < s; j++) acc += row[j]! * k[j]![i]!;
            ytmp[i] = y[i]! + hStep * acc;
          }
          rhs(t + C[s]! * hStep, ytmp, k[s]!);
        }
        // 5th-order solution and embedded error estimate.
        for (let i = 0; i < n; i++) {
          let bsum = 0;
          let esum = 0;
          for (let s = 0; s < STAGES; s++) {
            bsum += B[s]! * k[s]![i]!;
            esum += E[s]! * k[s]![i]!;
          }
          y5[i] = y[i]! + hStep * bsum;
          errVec[i] = hStep * esum;
        }
        for (let i = 0; i < n; i++) sc[i] = errorScale(atol, rtol, Math.max(Math.abs(y[i]!), Math.abs(y5[i]!)));
        const err = rmsNorm(errVec, sc);
        if (!Number.isFinite(err)) throw new IntegrationError('non-finite derivative during integration');

        if (err <= 1) {
          // Accept.
          t += hStep;
          y.set(y5);
          // Grow the natural step (the clamped hStep is not the controller's step).
          const fac = 0.9 * err ** (-1 / 5);
          h = h * Math.min(5, Math.max(0.2, fac));
          break;
        }
        // Reject: shrink and retry from the same (t, y); cap growth after a rejection.
        rejects += 1;
        const fac = Math.max(0.2, 0.9 * err ** (-1 / 5));
        h = h * Math.min(1, fac);
        if (rejects > maxRejects || hStep <= hMin) {
          throw new IntegrationError(`step size collapsed at t=${t} (err=${err}, h=${hStep})`);
        }
      }
    }
    out.push(Float64Array.from(y));
  }
  return out;
}
