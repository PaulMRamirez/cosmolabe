// Consider-covariance oracles. (1) A hand-computed scalar case: with a 1x1 information, a 1x1
// cross term, and a 1x1 a-priori consider covariance, the consider-covariance formula reduces to
// Pc = Pxx + (Pxx * Lxc)^2 * Pcc, which we check against the closed form. (2) Inflation is
// positive semidefinite: Pc - Pxx is PSD for a 6-state batch run with a range-bias consider
// parameter, so every diagonal of Pc is >= the corresponding diagonal of the estimate-only Pxx.

import { describe, expect, it } from 'vitest';
import { batchLeastSquares } from './batch-ls.ts';
import { considerCovariance } from './consider.ts';
import { SingularMatrixError } from './errors.ts';
import { mat, matVec, sub } from './linalg.ts';
import {
  earthForceModel,
  fixedObserver,
  makeRange,
  makeRangeRate,
  sampleTruth,
  truthState,
} from './test-fixtures.ts';
import type { Measurement } from './types.ts';

const FM = earthForceModel();
const OBS = fixedObserver();
const T0 = 0;
const EPOCHS = [60, 180, 300, 420, 540, 720, 900, 1080, 1200];

describe('consider covariance (closed form)', () => {
  it('matches the hand-computed scalar Pc = Pxx + (Pxx Lxc)^2 Pcc', () => {
    // Build a 6x6 information that is diagonal so the (0,0) block is decoupled and scalar-like.
    const lambdaXx = new Float64Array(36);
    for (let i = 0; i < 6; i++) lambdaXx[i * 6 + i] = i === 0 ? 4 : 100; // Lxx[0,0] = 4 => Pxx[0,0] = 0.25
    // A single consider parameter coupling only to state component 0: Lambda_xc = [3,0,0,0,0,0]^T.
    const lambdaXc = new Float64Array(6);
    lambdaXc[0] = 3;
    const pcc = Float64Array.of(2); // a-priori consider variance

    const pc = considerCovariance(lambdaXx, { crossInformation: lambdaXc, considerCovariance: pcc, count: 1 });

    const pxx00 = 0.25;
    const sxc0 = -pxx00 * 3; // -0.75
    const expected00 = pxx00 + sxc0 * sxc0 * 2; // 0.25 + 0.5625*2 = 1.375
    expect(pc[0]!).toBeCloseTo(expected00, 12);
    // Components 1..5 had zero cross term, so they are unchanged: Pc[i,i] = 1/100 = 0.01.
    for (let i = 1; i < 6; i++) expect(pc[i * 6 + i]!).toBeCloseTo(0.01, 12);
  });

  it('rejects an indefinite a-priori consider covariance loudly', () => {
    const lambdaXx = new Float64Array(36);
    for (let i = 0; i < 6; i++) lambdaXx[i * 6 + i] = 4;
    const lambdaXc = new Float64Array(12); // 6 x 2
    lambdaXc[0] = 3;
    lambdaXc[7] = 2;
    // A symmetric but INDEFINITE 2x2 Pcc (eigenvalues 1 +/- 2 => one negative). Used raw it could
    // make the inflation indefinite and break Pc >= Pxx, so it must be rejected on entry.
    const indefinitePcc = Float64Array.of(1, 2, 2, 1);
    expect(() =>
      considerCovariance(lambdaXx, { crossInformation: lambdaXc, considerCovariance: indefinitePcc, count: 2 }),
    ).toThrow(SingularMatrixError);
  });

  it('symmetrizes a slightly asymmetric (but PSD) consider covariance instead of failing', () => {
    const lambdaXx = new Float64Array(36);
    for (let i = 0; i < 6; i++) lambdaXx[i * 6 + i] = 4;
    const lambdaXc = new Float64Array(12); // 6 x 2
    lambdaXc[0] = 3;
    lambdaXc[7] = 2;
    // PSD matrix [[2, 0.5],[0.5, 2]] given with a rounding asymmetry in the off-diagonal.
    const asymPcc = Float64Array.of(2, 0.5, 0.5 + 1e-12, 2);
    const pc = considerCovariance(lambdaXx, {
      crossInformation: lambdaXc,
      considerCovariance: asymPcc,
      count: 2,
    });
    expect(pc).toHaveLength(36);
    // Inflation grows the affected diagonals above the estimate-only 1/4 = 0.25. Param 0 couples
    // to state 0 (lambdaXc[0]) and param 1 to state 3 (lambdaXc[7] = row 3, col 1).
    expect(pc[0]!).toBeGreaterThan(0.25);
    expect(pc[21]!).toBeGreaterThan(0.25); // Pc[3,3]
  });
});

describe('consider covariance (batch estimator)', () => {
  it('inflates the estimate covariance (Pc - Pxx positive semidefinite)', () => {
    const truth = truthState();
    const truthByEpoch = sampleTruth(truth, T0, EPOCHS, FM);
    const measurements: Measurement[] = [];
    EPOCHS.forEach((e, k) => {
      const s = truthByEpoch[k]!;
      measurements.push(makeRange(s, OBS, e, 1e-3));
      measurements.push(makeRangeRate(s, OBS, e, 1e-6));
    });

    const guess = Float64Array.from(truth);
    guess[0]! += 2;
    guess[4]! += 1e-3;

    // A single consider parameter: a constant range bias (km). dh/db = 1 on every RANGE
    // component, 0 on range-rate. A-priori bias uncertainty: 10 m => variance 1e-4 km^2.
    const result = batchLeastSquares({ x: guess, epoch: T0 }, measurements, {
      forceModel: FM,
      consider: {
        count: 1,
        covariance: Float64Array.of(1e-4),
        sensitivity: (m) => ({ partials: Float64Array.of(m.kind === 'range' ? 1 : 0) }),
      },
    });

    expect(result.considerCovariance).toBeDefined();
    const pxx = mat(6, 6, result.covariance);
    const pc = mat(6, 6, result.considerCovariance!);
    // Pc - Pxx must be positive semidefinite. With a single consider parameter the inflation is
    // rank 1 (so a Cholesky factor of the difference is degenerate); assert PSD directly by the
    // quadratic form v^T (Pc - Pxx) v >= 0 over a spread of probe vectors, including the unit axes.
    const diff = sub(pc, pxx);
    const probes: number[][] = [
      [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1], [1, -1, 1, -1, 1, -1], [2, -3, 0.5, 1, -1, 4],
    ];
    for (const p of probes) {
      const v = Float64Array.from(p);
      const dv = matVec(diff, v);
      let q = 0;
      for (let i = 0; i < 6; i++) q += v[i]! * dv[i]!;
      expect(q).toBeGreaterThanOrEqual(-1e-12);
    }
    // Every diagonal inflates: Pc[i,i] >= Pxx[i,i].
    for (let i = 0; i < 6; i++) {
      expect(result.considerCovariance![i * 6 + i]!).toBeGreaterThanOrEqual(result.covariance[i * 6 + i]! - 1e-15);
    }
    // The state estimate is identical to the no-consider run (consider does not change x-hat).
    const plain = batchLeastSquares({ x: guess, epoch: T0 }, measurements, { forceModel: FM });
    for (let i = 0; i < 6; i++) expect(result.state.x[i]!).toBeCloseTo(plain.state.x[i]!, 12);
  });
});
