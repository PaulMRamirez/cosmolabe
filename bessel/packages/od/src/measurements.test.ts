// Measurement-model tests: the analytic partial dh/dx of every measurement kind is
// checked against a central finite difference of h(state), and the predicted values are
// checked against the geometry that generated them. This pins the Jacobians the
// estimators depend on without needing the truth trajectory.

import { describe, expect, it } from 'vitest';
import { predict } from './measurements.ts';
import { measurementSize, type AnglesMeasurement, type Measurement } from './types.ts';

const OBS: [number, number, number] = [3000, 2500, 1500];
const STATE = Float64Array.of(5000, 4000, 3000, -1.2, 5.6, 4.1);

/** Central finite difference of the predicted value with respect to each state component. */
function fdJacobian(m: Measurement, state: Float64Array): Float64Array {
  const size = measurementSize(m);
  const jac = new Float64Array(size * 6);
  for (let j = 0; j < 6; j++) {
    const h = Math.max(1, Math.abs(state[j]!)) * 1e-6;
    const plus = Float64Array.from(state);
    const minus = Float64Array.from(state);
    plus[j]! += h;
    minus[j]! -= h;
    const vp = predict(m, plus).value;
    const vm = predict(m, minus).value;
    for (let i = 0; i < size; i++) jac[i * 6 + j] = (vp[i]! - vm[i]!) / (2 * h);
  }
  return jac;
}

function expectJacobianMatchesFd(m: Measurement, tol: number): void {
  const analytic = predict(m, STATE).jac;
  const fd = fdJacobian(m, STATE);
  for (let i = 0; i < analytic.length; i++) {
    expect(Math.abs(analytic[i]! - fd[i]!)).toBeLessThan(tol);
  }
}

describe('measurement models', () => {
  it('range value equals the geometric distance', () => {
    const m: Measurement = { kind: 'range', epoch: 0, observer: OBS, sigma: 1, value: 0 };
    const expected = Math.hypot(STATE[0]! - OBS[0], STATE[1]! - OBS[1], STATE[2]! - OBS[2]);
    expect(predict(m, STATE).value[0]!).toBeCloseTo(expected, 9);
  });

  it('range partial matches finite difference', () => {
    const m: Measurement = { kind: 'range', epoch: 0, observer: OBS, sigma: 1, value: 0 };
    expectJacobianMatchesFd(m, 1e-7);
  });

  it('range-rate partial matches finite difference (position and velocity)', () => {
    const m: Measurement = { kind: 'rangeRate', epoch: 0, observer: OBS, sigma: 1, value: 0 };
    expectJacobianMatchesFd(m, 1e-7);
  });

  it('right ascension / declination partial matches finite difference', () => {
    const m: AnglesMeasurement = { kind: 'angles', frame: 'radec', epoch: 0, observer: OBS, sigma: [1e-5, 1e-5], value: [0, 0] };
    expectJacobianMatchesFd(m, 1e-9);
  });

  it('azimuth / elevation partial matches finite difference', () => {
    const enu = {
      east: [0, 1, 0] as [number, number, number],
      north: [0, 0, 1] as [number, number, number],
      up: [1, 0, 0] as [number, number, number],
    };
    const m: AnglesMeasurement = { kind: 'angles', frame: 'azel', epoch: 0, observer: OBS, sigma: [1e-5, 1e-5], value: [0, 0], enu };
    expectJacobianMatchesFd(m, 1e-9);
  });
});
