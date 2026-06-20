// State-noise compensation (SNC) in the EKF. Independent oracle (not circular): run the filter
// against a truth that carries an UNMODELED constant acceleration (a small along-track "thrust"
// the filter's dynamics omit), a textbook mismodeled/maneuvering case. Without process noise the
// filter's covariance collapses while the estimate drifts off truth: it grows wildly
// overconfident (the position error reaches hundreds of sigma and the per-step NIS blows far past
// any consistency bound, the signature of divergence). Turning on SNC, a continuous white-noise
// acceleration integrated into Q each time update, inflates the covariance to absorb the
// mismodeling, so the error stays within a few sigma and the NIS stays bounded near the
// measurement size, a consistent filter. The two filters share everything but the SNC option, so
// the consistency improvement is attributable to SNC alone.
// References: Tapley, Schutz & Born, "Statistical Orbit Determination", section 4.9 (process
// noise / state-noise compensation); Vallado section 10.3. (STK-class OD.)

import { describe, expect, it } from 'vitest';
import { createForceModel, pointMass, type ForceTerm } from '@bessel/propagator';
import { ExtendedKalmanFilter } from './ekf.ts';
import { EARTH, fixedObserver, makeRaDec, makeRange, sampleTruth, truthState } from './test-fixtures.ts';
import type { Measurement } from './types.ts';

const OBS = fixedObserver();

/** A constant inertial acceleration (km/s^2): an unmodeled thrust the filter dynamics omit. */
function constantAccel(a: readonly [number, number, number]): ForceTerm {
  return { name: 'unmodeled-thrust', acceleration: () => [a[0], a[1], a[2]] };
}

function diagCovariance(values: readonly number[]): Float64Array {
  const c = new Float64Array(36);
  for (let i = 0; i < 6; i++) c[i * 6 + i] = values[i]!;
  return c;
}

function posError(estimate: Float64Array, truth: Float64Array): number {
  return Math.hypot(estimate[0]! - truth[0]!, estimate[1]! - truth[1]!, estimate[2]! - truth[2]!);
}

/** Run the filter over the measurement stream; return final error, position sigma, and late NIS. */
function runFilter(
  filterFm: ReturnType<typeof createForceModel>,
  measurements: readonly Measurement[],
  truthLast: Float64Array,
  snc?: { sigmaAccel: number },
): { errOverSigma: number; meanLateNis: number; finalError: number } {
  const ekf = new ExtendedKalmanFilter(
    { x: Float64Array.from(truthState()), epoch: 0 },
    diagCovariance([1e-2, 1e-2, 1e-2, 1e-6, 1e-6, 1e-6]),
    { forceModel: filterFm, snc },
  );
  let sumNis = 0;
  let cnt = 0;
  for (const m of measurements) {
    const step = ekf.update(m);
    if (m.epoch > 1800) {
      sumNis += step.nis;
      cnt += 1;
    }
  }
  const cur = ekf.current();
  const cov = ekf.currentCovariance();
  const posSigma = Math.sqrt(cov[0]! + cov[7]! + cov[14]!);
  const finalError = posError(cur.x, truthLast);
  return { errOverSigma: finalError / posSigma, meanLateNis: sumNis / cnt, finalError };
}

describe('EKF state-noise compensation', () => {
  // Truth = point-mass + an unmodeled along-track acceleration; filter = point-mass only.
  const truthFm = createForceModel([pointMass(EARTH.gm), constantAccel([0, 1e-6, 0])]);
  const filterFm = createForceModel([pointMass(EARTH.gm)]);
  const truth = truthState();
  const epochs: number[] = [];
  for (let t = 30; t <= 3600; t += 30) epochs.push(t);
  const truthByEpoch = sampleTruth(truth, 0, epochs, truthFm);
  const truthLast = truthByEpoch[truthByEpoch.length - 1]!;

  const measurements: Measurement[] = [];
  epochs.forEach((e, k) => {
    const s = truthByEpoch[k]!;
    measurements.push(makeRange(s, OBS, e, 5e-3));
    measurements.push(makeRaDec(s, OBS, e, [5e-6, 5e-6]));
  });

  it('the no-process-noise filter diverges (overconfident, NIS unbounded)', () => {
    const noQ = runFilter(filterFm, measurements, truthLast);
    // Covariance collapses while the estimate drifts: error is many tens of sigma and the NIS
    // runs orders of magnitude above any consistency bound (the measurement size is 1 or 2).
    expect(noQ.errOverSigma).toBeGreaterThan(50);
    expect(noQ.meanLateNis).toBeGreaterThan(100);
  });

  it('SNC keeps the filter consistent on the same mismodeled truth', () => {
    // SNC sized to the unmodeled acceleration inflates Q so the covariance brackets the error.
    const snc = runFilter(filterFm, measurements, truthLast, { sigmaAccel: 3e-6 });
    // The estimate now stays within a few sigma and the NIS settles near the measurement size
    // (range is size 1, angles size 2, so a per-step NIS of order 1 to a few is consistent).
    expect(snc.errOverSigma).toBeLessThan(5);
    expect(snc.meanLateNis).toBeLessThan(5);
  });

  it('SNC both shrinks the actual error and reins in the overconfidence vs no process noise', () => {
    const noQ = runFilter(filterFm, measurements, truthLast);
    const snc = runFilter(filterFm, measurements, truthLast, { sigmaAccel: 3e-6 });
    expect(snc.finalError).toBeLessThan(noQ.finalError); // closer to truth
    expect(snc.errOverSigma).toBeLessThan(noQ.errOverSigma / 10); // far better calibrated
    expect(snc.meanLateNis).toBeLessThan(noQ.meanLateNis / 10);
  });

  it('rejects a negative SNC sigma (fails loudly)', () => {
    expect(
      () =>
        new ExtendedKalmanFilter({ x: Float64Array.from(truth), epoch: 0 }, diagCovariance([1, 1, 1, 1, 1, 1]), {
          forceModel: filterFm,
          snc: { sigmaAccel: -1 },
        }),
    ).toThrow();
  });
});
