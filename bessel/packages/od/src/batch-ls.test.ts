// Batch least-squares oracle: self-consistency against a truth trajectory. Propagate a
// known truth state under point-mass + J2, synthesize PERFECT (zero-noise) range,
// range-rate, and angle measurements from a known observer, perturb the initial guess
// off truth, and assert batch-LS recovers truth to a tight tolerance with ~0 residual
// RMS. A second case adds small deterministic Gaussian noise and asserts the estimate is
// within a few sigma and the covariance is positive definite.

import { describe, expect, it } from 'vitest';
import { batchLeastSquares } from './batch-ls.ts';
import { ConvergenceError } from './errors.ts';
import { isPositiveDefinite, mat } from './linalg.ts';
import {
  earthForceModel,
  fixedObserver,
  gaussian,
  lcg,
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

/** Measurement epochs spread over ~20 minutes (a partial pass). */
const EPOCHS = [60, 180, 300, 420, 540, 720, 900, 1080, 1200];

function buildPerfectMeasurements(truthByEpoch: Float64Array[]): Measurement[] {
  const out: Measurement[] = [];
  EPOCHS.forEach((e, k) => {
    const s = truthByEpoch[k]!;
    out.push(makeRange(s, OBS, e, 1e-3));
    out.push(makeRangeRate(s, OBS, e, 1e-6));
    out.push(makeRaDec(s, OBS, e, [1e-6, 1e-6]));
  });
  return out;
}

describe('batch least squares', () => {
  it('recovers the truth state from perfect measurements to tight tolerance', () => {
    const truth = truthState();
    const truthByEpoch = sampleTruth(truth, T0, EPOCHS, FM);
    const measurements = buildPerfectMeasurements(truthByEpoch);

    // Perturb the guess: 5 km position, 5 mm/s velocity off truth.
    const guess = Float64Array.from(truth);
    guess[0]! += 5;
    guess[1]! -= 3;
    guess[2]! += 2;
    guess[3]! += 5e-3;
    guess[4]! -= 4e-3;
    guess[5]! += 2e-3;

    const result = batchLeastSquares({ x: guess, epoch: T0 }, measurements, { forceModel: FM });

    for (let i = 0; i < 3; i++) expect(Math.abs(result.state.x[i]! - truth[i]!)).toBeLessThan(1e-3);
    for (let i = 3; i < 6; i++) expect(Math.abs(result.state.x[i]! - truth[i]!)).toBeLessThan(1e-6);
    expect(result.residualRms).toBeLessThan(1e-3);
    expect(result.iterations).toBeLessThanOrEqual(20);
    expect(isPositiveDefinite(mat(6, 6, result.covariance))).toBe(true);
  });

  it('converges with range-only data (weaker geometry, still observable over an arc)', () => {
    const truth = truthState();
    const truthByEpoch = sampleTruth(truth, T0, EPOCHS, FM);
    const measurements: Measurement[] = EPOCHS.map((e, k) => makeRange(truthByEpoch[k]!, OBS, e, 1e-3));

    const guess = Float64Array.from(truth);
    guess[0]! += 2;
    guess[4]! += 1e-3;

    const result = batchLeastSquares({ x: guess, epoch: T0 }, measurements, { forceModel: FM });
    for (let i = 0; i < 3; i++) expect(Math.abs(result.state.x[i]! - truth[i]!)).toBeLessThan(1e-2);
    expect(result.residualRms).toBeLessThan(1e-3);
  });

  it('surfaces divergence loudly instead of reporting a false convergence', () => {
    // A guess thousands of km and km/s off truth makes the Gauss-Newton linearization invalid:
    // the step overshoots and the residual RMS GROWS on a sustained run. The old stopping rule
    // (relResidualChange <= tol fires for a NEGATIVE change too) would report converged:true with
    // the unimproved, wrong state. It must now throw a ConvergenceError naming the divergence.
    const truth = truthState();
    const truthByEpoch = sampleTruth(truth, T0, EPOCHS, FM);
    const measurements: Measurement[] = EPOCHS.map((e, k) => makeRange(truthByEpoch[k]!, OBS, e, 1e-3));

    const guess = Float64Array.from(truth);
    guess[0]! += 6000;
    guess[1]! += 6000;
    guess[3]! += 5;
    guess[4]! += 5;

    let caught: unknown;
    try {
      batchLeastSquares({ x: guess, epoch: T0 }, measurements, { forceModel: FM, maxIterations: 30 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConvergenceError);
    expect((caught as Error).message).toMatch(/diverged/);
    expect((caught as Error).message).toMatch(/consecutive/);
  });

  it('produces a near-truth estimate within a few sigma under noisy measurements', () => {
    const truth = truthState();
    const truthByEpoch = sampleTruth(truth, T0, EPOCHS, FM);

    const rng = gaussian(lcg(20260615));
    const rangeSigma = 0.02; // 20 m
    const rateSigma = 2e-5; // 2 cm/s
    const angSigma = 5e-6; // ~1 arcsec

    const measurements: Measurement[] = [];
    EPOCHS.forEach((e, k) => {
      const s = truthByEpoch[k]!;
      measurements.push(makeRange(s, OBS, e, rangeSigma, rng() * rangeSigma));
      measurements.push(makeRangeRate(s, OBS, e, rateSigma, rng() * rateSigma));
      measurements.push(makeRaDec(s, OBS, e, [angSigma, angSigma], [rng() * angSigma, rng() * angSigma]));
    });

    const guess = Float64Array.from(truth);
    guess[0]! += 1;
    guess[4]! += 1e-3;

    const result = batchLeastSquares({ x: guess, epoch: T0 }, measurements, { forceModel: FM });

    // Covariance positive definite, and each component within 5-sigma of truth.
    expect(isPositiveDefinite(mat(6, 6, result.covariance))).toBe(true);
    for (let i = 0; i < 6; i++) {
      const sigma = Math.sqrt(result.covariance[i * 6 + i]!);
      expect(Math.abs(result.state.x[i]! - truth[i]!)).toBeLessThan(5 * sigma + 1e-9);
    }
    // The post-fit normalized residual RMS should be order 1 for a well-scaled fit.
    expect(result.residualRms).toBeGreaterThan(0);
    expect(result.residualRms).toBeLessThan(5);
  });
});
