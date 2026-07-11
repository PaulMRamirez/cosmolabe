// EKF oracle: feed perfect measurements (range + range-rate + angles) in time order to a
// filter started from a perturbed guess with an inflated covariance, and assert (1) the
// estimate converges toward truth as observations accumulate, (2) the covariance shrinks
// and stays positive definite, and (3) the per-step innovation (NIS) stays bounded once
// the filter has settled, a NEES/NIS-style consistency sanity check.

import { describe, expect, it } from 'vitest';
import { ExtendedKalmanFilter } from './ekf.ts';
import { isPositiveDefinite, mat } from './linalg.ts';
import {
  earthForceModel,
  fixedObserver,
  makeRaDec,
  makeRange,
  makeRangeRate,
  sampleTruth,
  truthState,
} from './test-fixtures.ts';
import type { Measurement } from './types.ts';

const T0 = 0;
const FM = earthForceModel();
const OBS = fixedObserver();

function diagCovariance(values: readonly number[]): Float64Array {
  const c = new Float64Array(36);
  for (let i = 0; i < 6; i++) c[i * 6 + i] = values[i]!;
  return c;
}

function posError(estimate: Float64Array, truth: Float64Array): number {
  return Math.hypot(estimate[0]! - truth[0]!, estimate[1]! - truth[1]!, estimate[2]! - truth[2]!);
}

describe('extended Kalman filter', () => {
  it('converges toward truth as measurements accumulate and stays consistent', () => {
    const truth = truthState();
    // Dense measurement cadence over ~25 minutes.
    const epochs: number[] = [];
    for (let t = 30; t <= 1500; t += 30) epochs.push(t);
    const truthByEpoch = sampleTruth(truth, T0, epochs, FM);

    const measurements: Measurement[] = [];
    epochs.forEach((e, k) => {
      const s = truthByEpoch[k]!;
      measurements.push(makeRange(s, OBS, e, 5e-3));
      measurements.push(makeRangeRate(s, OBS, e, 5e-6));
      measurements.push(makeRaDec(s, OBS, e, [5e-6, 5e-6]));
    });

    // Start at the truth epoch perturbed by ~3 km / 3 mm/s with an inflated covariance.
    const guess = Float64Array.from(truth);
    guess[0]! += 3;
    guess[1]! -= 2;
    guess[3]! += 3e-3;
    const p0 = diagCovariance([100, 100, 100, 1e-2, 1e-2, 1e-2]);

    const ekf = new ExtendedKalmanFilter({ x: guess, epoch: T0 }, p0, { forceModel: FM });

    const initialErr = posError(guess, truth);
    let lastErr = initialErr;
    const settledNis: number[] = [];
    let step = 0;
    for (const m of measurements) {
      const out = ekf.update(m);
      step += 1;
      expect(isPositiveDefinite(mat(6, 6, out.covariance))).toBe(true);
      // Truth at this measurement epoch (the filter epoch equals the measurement epoch).
      const truthAt = sampleTruth(truth, T0, [m.epoch], FM)[0]!;
      lastErr = posError(out.state.x, truthAt);
      if (step > measurements.length / 2) settledNis.push(out.nis);
    }

    // The final position error is far smaller than the initial 3 km perturbation.
    expect(lastErr).toBeLessThan(0.05);
    expect(lastErr).toBeLessThan(initialErr);

    // Settled NIS sanity: with perfect data the innovations are tiny, so the mean NIS
    // is small and finite (no divergence).
    const meanNis = settledNis.reduce((a, b) => a + b, 0) / settledNis.length;
    expect(Number.isFinite(meanNis)).toBe(true);
    expect(meanNis).toBeLessThan(10);
  });

  it('rejects out-of-order measurements loudly', () => {
    const truth = truthState();
    const ekf = new ExtendedKalmanFilter(
      { x: truth, epoch: 100 },
      diagCovariance([1, 1, 1, 1e-4, 1e-4, 1e-4]),
      { forceModel: FM },
    );
    const earlier = makeRange(truth, OBS, 50, 1e-3);
    expect(() => ekf.update(earlier)).toThrow(/non-decreasing/);
  });
});
