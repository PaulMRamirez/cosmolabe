// The State Transition Matrix from the variational equations, validated against the
// trajectory itself: a CENTRAL finite difference of the nonlinear flow recovers the
// linear response Phi * delta to O(delta^3), so the analytic STM must reproduce it to
// high precision (for point-mass AND J2). Plus Phi(t0,t0)=I, the symplectic invariant
// det(Phi)=1, determinism, and the StmUnsupportedError guard. (STK_PARITY_SPEC §4.2.)

import { describe, it, expect } from 'vitest';
import { integrateDense } from './dense.ts';
import { augmentInitialState, makeStmRhs, STM_DIM } from './stm.ts';
import { StmUnsupportedError } from './errors.ts';
import { createForceModel } from './force/model.ts';
import { pointMass } from './force/point-mass.ts';
import { zonalHarmonics } from './force/zonal.ts';
import type { ForceModel } from './force/types.ts';
import type { Rhs } from './integrator.ts';

const EARTH = { gm: 398600.4418, j2: 1.08262668e-3, re: 6378.137 };
const Y0 = Float64Array.of(7000, 200, -150, 0.5, 6.5, 3.0);
const TF = 2400;
const TOL = { rtol: 1e-13, atol: 1e-13 } as const;

const stateRhs = (model: ForceModel): Rhs => (t, y, dy) => {
  const a = model.acceleration({ et: t, r: [y[0]!, y[1]!, y[2]!], v: [y[3]!, y[4]!, y[5]!] });
  dy[0] = y[3]!;
  dy[1] = y[4]!;
  dy[2] = y[5]!;
  dy[3] = a[0];
  dy[4] = a[1];
  dy[5] = a[2];
};

/** Propagate a bare 6-state to TF and return the state there. */
function propState(model: ForceModel, y0: Float64Array): Float64Array {
  return integrateDense(stateRhs(model), y0, 0, TF, TOL).solution.interpolate(TF);
}

/** The analytic 6x6 STM Phi(TF, 0) (row-major) for `model`. */
function analyticStm(model: ForceModel): Float64Array {
  const y0 = augmentInitialState(Y0);
  const yf = integrateDense(makeStmRhs(model), y0, 0, TF, TOL).solution.interpolate(TF);
  return yf.slice(6, 42);
}

/** Multiply a row-major 6x6 by a length-6 vector. */
function matVec(m: Float64Array, v: number[]): number[] {
  const out = new Array<number>(6).fill(0);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) out[i]! += m[i * 6 + j]! * v[j]!;
  return out;
}

/** Determinant of a row-major 6x6 by Gaussian elimination with partial pivoting. */
function det6(m: Float64Array): number {
  const a = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => m[i * 6 + j]!));
  let det = 1;
  for (let col = 0; col < 6; col++) {
    let piv = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (a[piv]![col] === 0) return 0;
    if (piv !== col) {
      [a[piv], a[col]] = [a[col]!, a[piv]!];
      det = -det;
    }
    det *= a[col]![col]!;
    for (let r = col + 1; r < 6; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < 6; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return det;
}

describe('STM via variational equations', () => {
  it('seeds Phi(t0, t0) = identity', () => {
    const y0 = augmentInitialState(Y0);
    const phi = integrateDense(makeStmRhs(createForceModel([pointMass(EARTH.gm)])), y0, 0, TF, TOL).solution.interpolate(0).slice(6, 42);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) expect(phi[i * 6 + j]).toBeCloseTo(i === j ? 1 : 0, 9);
  });

  for (const [label, model] of [
    ['point-mass', createForceModel([pointMass(EARTH.gm)])],
    ['point-mass + J2 (FD partials)', createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2: EARTH.j2 })])],
  ] as const) {
    it(`matches the finite-difference flow response for ${label}`, () => {
      const phi = analyticStm(model);
      // A small mixed perturbation; central differencing cancels the quadratic term.
      const delta = [1e-3, -8e-4, 5e-4, 2e-7, -3e-7, 1e-7];
      const plus = Float64Array.from(Y0, (v, i) => v + delta[i]!);
      const minus = Float64Array.from(Y0, (v, i) => v - delta[i]!);
      const sp = propState(model, plus);
      const sm = propState(model, minus);
      const fdLinear = Array.from({ length: 6 }, (_, i) => (sp[i]! - sm[i]!) / 2);
      const predicted = matVec(phi, delta);
      // Position to ~1e-7 km, velocity to ~1e-10 km/s: STM*delta reproduces the flow.
      for (let i = 0; i < 3; i++) expect(predicted[i]!).toBeCloseTo(fdLinear[i]!, 7);
      for (let i = 3; i < 6; i++) expect(predicted[i]!).toBeCloseTo(fdLinear[i]!, 10);
    });
  }

  it('preserves the symplectic invariant det(Phi) = 1 (point-mass)', () => {
    const phi = analyticStm(createForceModel([pointMass(EARTH.gm)]));
    expect(det6(phi)).toBeCloseTo(1, 6);
  });

  it('is deterministic (identical inputs, identical STM)', () => {
    const model = createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2: EARTH.j2 })]);
    const a = analyticStm(model);
    const b = analyticStm(model);
    for (let i = 0; i < 36; i++) expect(a[i]).toBe(b[i]);
  });

  it('augmentInitialState builds a 42-vector seeded to identity', () => {
    const y = augmentInitialState(Y0);
    expect(y.length).toBe(STM_DIM);
    for (let i = 0; i < 6; i++) expect(y[i]).toBe(Y0[i]);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) expect(y[6 + i * 6 + j]).toBe(i === j ? 1 : 0);
  });

  it('throws StmUnsupportedError when a term lacks partials and FD is disabled', () => {
    const model = createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2: EARTH.j2 })]);
    const rhs = makeStmRhs(model, false); // zonal has no analytic partials()
    expect(() => integrateDense(rhs, augmentInitialState(Y0), 0, 60, TOL)).toThrow(StmUnsupportedError);
  });
});
