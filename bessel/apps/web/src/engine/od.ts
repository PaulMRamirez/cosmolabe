// The orbit-determination demonstration: synthesize a small, deterministic range and
// range-rate measurement set from a known truth orbit (sampled with the same J2 Earth
// force model), perturb the initial guess, and recover the state with @bessel/od batch
// least squares. SPICE-free and self-contained, so the panel always works. The result
// shapes the estimate error, residual RMS, and 1-sigma position uncertainty for the
// readout. Units: km, km/s, seconds, radians. (Tapley-Schutz-Born §4.3; Vallado §10.2.)

import { createForceModel, pointMass, zonalHarmonics, type ForceModel } from '@bessel/propagator';
import {
  batchLeastSquares,
  predict,
  propagateArc,
  type Measurement,
  type ObserverPosition,
} from '@bessel/od';
import type { OdResult } from '../store/index.ts';

const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;
const EARTH_J2 = 1.08262668e-3;

// The truth orbit: a ~700 km circular LEO state on the +X axis (km, km/s), and a single
// inertial observer offset from the geocenter (a stand-in ground station in ECI).
const TRUTH_STATE = Float64Array.of(7078.137, 0, 0, 0, 6.6126, 3.8189);
const OBSERVER: ObserverPosition = [6378.137, 1000, 2000];
const SOLVE_EPOCH = 0;
const SAMPLE_EPOCHS = [60, 180, 300, 420, 540, 720, 900, 1080, 1200];

/** The J2 Earth force model the truth and the estimator both use. */
function earthForceModel(): ForceModel {
  return createForceModel([
    pointMass(EARTH_GM),
    zonalHarmonics({ gm: EARTH_GM, re: EARTH_RE }, { j2: EARTH_J2 }),
  ]);
}

/** Sample the truth 6-state at each requested epoch via a single propagated arc. */
function sampleTruth(epochs: readonly number[], fm: ForceModel): Float64Array[] {
  const arc = propagateArc(TRUTH_STATE, SOLVE_EPOCH, epochs, fm, 'J2000');
  return epochs.map((et) => Float64Array.from(arc.stateAt(et)));
}

/** A reproducible normal sample (Box-Muller over a small LCG), so the demo is stable. */
function noiseStream(seed: number): () => number {
  let s = seed >>> 0;
  const next = (): number => {
    s = (1664525 * s + 1013904223) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
  return () => {
    const u1 = Math.max(next(), 1e-12);
    const u2 = next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

/**
 * Build a range + range-rate + right-ascension/declination measurement set from the
 * truth, with Gaussian noise. The angles strongly constrain the position direction
 * (range alone from one station is poorly observable), so the batch fully recovers
 * the state.
 */
function buildMeasurements(
  truthByEpoch: readonly Float64Array[],
  rangeSigma: number,
  rateSigma: number,
  angleSigma: number,
): Measurement[] {
  const noise = noiseStream(12345);
  const out: Measurement[] = [];
  SAMPLE_EPOCHS.forEach((epoch, k) => {
    const state = truthByEpoch[k]!;
    const range = predict({ kind: 'range', value: 0, sigma: rangeSigma, epoch, observer: OBSERVER }, state)
      .value[0]!;
    const rate = predict({ kind: 'rangeRate', value: 0, sigma: rateSigma, epoch, observer: OBSERVER }, state)
      .value[0]!;
    const angles = predict(
      { kind: 'angles', frame: 'radec', value: [0, 0], sigma: [angleSigma, angleSigma], epoch, observer: OBSERVER },
      state,
    ).value;
    out.push({ kind: 'range', value: range + noise() * rangeSigma, sigma: rangeSigma, epoch, observer: OBSERVER });
    out.push({
      kind: 'rangeRate',
      value: rate + noise() * rateSigma,
      sigma: rateSigma,
      epoch,
      observer: OBSERVER,
    });
    out.push({
      kind: 'angles',
      frame: 'radec',
      value: [angles[0]! + noise() * angleSigma, angles[1]! + noise() * angleSigma],
      sigma: [angleSigma, angleSigma],
      epoch,
      observer: OBSERVER,
    });
  });
  return out;
}

/** Run the batch-least-squares OD demonstration and reduce it into a store-ready result. */
export function runOdDemo(noiseScale: number): OdResult {
  const fm = earthForceModel();
  const truthByEpoch = sampleTruth(SAMPLE_EPOCHS, fm);
  const rangeSigma = 1e-2 * Math.max(0.01, noiseScale); // km
  const rateSigma = 1e-5 * Math.max(0.01, noiseScale); // km/s
  const angleSigma = 1e-5 * Math.max(0.01, noiseScale); // rad
  const measurements = buildMeasurements(truthByEpoch, rangeSigma, rateSigma, angleSigma);

  // Perturb the guess off truth: a few km in position, a few m/s in velocity.
  const guess = Float64Array.from(TRUTH_STATE);
  guess[0]! += 3;
  guess[1]! -= 2;
  guess[4]! += 3e-3;

  const result = batchLeastSquares({ x: guess, epoch: SOLVE_EPOCH }, measurements, { forceModel: fm });

  const est = result.state.x;
  const dr = Math.hypot(est[0]! - TRUTH_STATE[0]!, est[1]! - TRUTH_STATE[1]!, est[2]! - TRUTH_STATE[2]!);
  const dv = Math.hypot(est[3]! - TRUTH_STATE[3]!, est[4]! - TRUTH_STATE[4]!, est[5]! - TRUTH_STATE[5]!);
  // The covariance diagonal entries (0, 7, 14) are the position variances (km^2).
  const cov = result.covariance;
  const sigmaPositionKm: [number, number, number] = [
    Math.sqrt(Math.max(0, cov[0]!)),
    Math.sqrt(Math.max(0, cov[7]!)),
    Math.sqrt(Math.max(0, cov[14]!)),
  ];

  return {
    estimate: Array.from(est),
    positionErrorKm: dr,
    velocityErrorKmS: dv,
    residualRms: result.residualRms,
    iterations: result.iterations,
    observationCount: result.observationCount,
    sigmaPositionKm,
    label: `Batch LS: ${SAMPLE_EPOCHS.length} epochs, range + range-rate`,
  };
}
