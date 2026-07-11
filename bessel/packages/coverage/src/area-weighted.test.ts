// Area-weighted coverage oracle. Pure (no SPICE): builds CoverageCells with known
// latitudes and known per-cell coverage, then asserts the cos(lat)-weighted mean
// against a hand-computed value that differs from the naive unweighted mean, and
// against the cos(lat) integral for a finely sampled latitude band. (STK_PARITY_SPEC §4.4.)

import { describe, it, expect } from 'vitest';
import { figureOfMerit, areaWeightedPercentCoverage } from './index.ts';
import type { CoverageCell } from './index.ts';

const DEG = Math.PI / 180;

/** Build a minimal CoverageCell at a latitude with a forced percentCoverage. */
function cellAt(latRad: number, coverage: number, row: number): CoverageCell {
  // Drive percentCoverage exactly via a hand-built window over [0, 1].
  const fom = figureOfMerit(coverage > 0 ? [[0, coverage]] : [], [0, 1]);
  return { latRad, lonRad: 0, rowIndex: row, colIndex: 0, fom, nFoldCoverage: [coverage] };
}

describe('areaWeightedPercentCoverage', () => {
  it('weights two lat bands by cos(lat), diverging from the naive mean', () => {
    // Band at the equator (cos 0 deg = 1) fully covered; band at 60 deg
    // (cos 60 deg = 0.5) never covered.
    const cells = [cellAt(0, 1.0, 0), cellAt(60 * DEG, 0.0, 1)];

    // Naive unweighted mean = (1 + 0) / 2 = 0.5.
    const naive = cells.reduce((a, c) => a + c.fom.percentCoverage, 0) / cells.length;
    expect(naive).toBeCloseTo(0.5, 9);

    // Area-weighted = (1*1.0 + 0.5*0.0) / (1 + 0.5) = 1.0 / 1.5 = 2/3.
    const weighted = areaWeightedPercentCoverage(cells);
    expect(weighted).toBeCloseTo(2 / 3, 9);
    // It must differ from the naive mean.
    expect(Math.abs(weighted - naive)).toBeGreaterThan(0.1);
  });

  it('matches the cos(lat) integral for a finely sampled half-covered band', () => {
    // Rows uniformly in [-80, 80] deg; the northern half (lat >= 0) is fully
    // covered, the southern half is dark. The cos-weighted covered fraction is
    // integral_{0}^{L} cos(lat) dlat / integral_{-L}^{L} cos(lat) dlat
    //   = sin(L) / (2 sin(L)) = 1/2, by symmetry of cos about the equator.
    const L = 80 * DEG;
    const rows = 161; // odd count so a row sits exactly on the equator
    const cells: CoverageCell[] = [];
    for (let r = 0; r < rows; r++) {
      const lat = -L + (2 * L * r) / (rows - 1);
      cells.push(cellAt(lat, lat >= 0 ? 1.0 : 0.0, r));
    }
    const weighted = areaWeightedPercentCoverage(cells);
    // Discrete cos-weighted sum approaches the continuous integral; the equatorial
    // row tips it slightly above 0.5, so assert against the integral within the
    // finite-sampling tolerance rather than to machine precision.
    expect(weighted).toBeCloseTo(0.5, 2);

    // A naive mean of the same cells also gives ~0.5 here (symmetric count), so use
    // an asymmetric coverage band to prove the weighting actually bites: cover only
    // lat >= 60 deg. cos-weighted covered fraction = (sin L - sin 60) / (2 sin L).
    const cells2: CoverageCell[] = [];
    for (let r = 0; r < rows; r++) {
      const lat = -L + (2 * L * r) / (rows - 1);
      cells2.push(cellAt(lat, lat >= 60 * DEG ? 1.0 : 0.0, r));
    }
    const weighted2 = areaWeightedPercentCoverage(cells2);
    const expected = (Math.sin(L) - Math.sin(60 * DEG)) / (2 * Math.sin(L));
    // Within the finite-sampling tolerance of the discrete cos-weighted sum.
    expect(weighted2).toBeCloseTo(expected, 2);
  });

  it('returns 0 for an empty grid', () => {
    expect(areaWeightedPercentCoverage([])).toBe(0);
  });
});
