import { describe, it, expect } from 'vitest';
import { type CoverageCell, type FigureOfMerit } from '@bessel/coverage';
import {
  COVERAGE_METRICS,
  coverageMetric,
  metricScalars,
  summarizeCoverage,
  walkerSemiMajorAxisKm,
  walkerStateAt,
  meanMotion,
} from './coverage-metric.ts';

// A FOM with the given fields, zero-filled otherwise, for building synthetic cells.
function fom(partial: Partial<FigureOfMerit>): FigureOfMerit {
  return {
    percentCoverage: 0,
    accessCount: 0,
    meanGapSec: 0,
    maxGapSec: 0,
    timeToFirstSec: null,
    meanAccessDurationSec: 0,
    maxAccessDurationSec: 0,
    revisitMaxSec: 0,
    revisitMeanSec: 0,
    responseTimeSec: null,
    ...partial,
  };
}

function cell(latRad: number, f: Partial<FigureOfMerit>, nFold: number[] = []): CoverageCell {
  return { latRad, lonRad: 0, rowIndex: 0, colIndex: 0, fom: fom(f), nFoldCoverage: nFold };
}

describe('metricScalars (the metric -> colormap [0,1] mapping is pure)', () => {
  it('maps percentCoverage directly into [0,1]', () => {
    const cells = [cell(0, { percentCoverage: 0 }), cell(0, { percentCoverage: 0.5 }), cell(0, { percentCoverage: 1 })];
    expect(metricScalars(cells, COVERAGE_METRICS.percentCoverage, 1)).toEqual([0, 0.5, 1]);
  });

  it('inverts a higher-is-worse metric (a short revisit gap reads brighter)', () => {
    const cells = [cell(0, { revisitMaxSec: 600 }), cell(0, { revisitMaxSec: 0 })];
    // 600 s is the worst -> 0; 0 s is the best -> 1.
    expect(metricScalars(cells, COVERAGE_METRICS.revisitMax, 1)).toEqual([0, 1]);
  });

  it('treats a never-accessed response time as the worst case (0)', () => {
    const cells = [cell(0, { responseTimeSec: 60 }), cell(0, { responseTimeSec: null })];
    const out = metricScalars(cells, COVERAGE_METRICS.responseTime, 1);
    expect(out[0]).toBe(1); // the only finite value, best after inversion
    expect(out[1]).toBe(0); // never accessed
  });

  it('maps a degenerate (all-equal) unbounded metric to all-1 rather than all-dark', () => {
    const cells = [cell(0, { revisitMaxSec: 300 }), cell(0, { revisitMaxSec: 300 })];
    expect(metricScalars(cells, COVERAGE_METRICS.revisitMax, 1)).toEqual([1, 1]);
  });

  it('reads the N-fold k-th order fraction for the nFold metric', () => {
    const cells = [cell(0, {}, [0.9, 0.4]), cell(0, {}, [0.9, 0.1])];
    // k=2 reads index 1 of nFoldCoverage.
    expect(metricScalars(cells, COVERAGE_METRICS.nFold, 2)).toEqual([0.4, 0.1]);
  });
});

describe('walkerStateAt + walkerSemiMajorAxisKm (the asset-set-from-Walker geometry is pure)', () => {
  it('gives a circular state: position at radius a, speed a*n, the two perpendicular', () => {
    const el = { a: walkerSemiMajorAxisKm(700), e: 0, i: 0.9, raan: 1.2, argp: 0, m0: 0, epoch: 0 };
    const n = meanMotion(el.a, 398600.4418);
    const { pos, vel } = walkerStateAt(el, n, 0.7);
    expect(Math.hypot(...pos)).toBeCloseTo(el.a, 6);
    expect(Math.hypot(...vel)).toBeCloseTo(el.a * n, 9);
    // On a circular orbit the radius and velocity are perpendicular.
    const dot = pos[0] * vel[0] + pos[1] * vel[1] + pos[2] * vel[2];
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('returns to the same position after one full revolution (the ring closes)', () => {
    const el = { a: 7000, e: 0, i: 0.5, raan: 2.1, argp: 0.3, m0: 0, epoch: 0 };
    const start = walkerStateAt(el, 0, 0).pos;
    const end = walkerStateAt(el, 0, 2 * Math.PI).pos;
    expect(Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2])).toBeLessThan(1e-6);
  });
});

describe('summarizeCoverage + coverageSummaryRows (the FOM summary aggregate)', () => {
  it('aggregates coverage min/mean/max, worst revisit, and N-fold cell fraction', () => {
    const cells = [
      cell(0, { percentCoverage: 0.2, revisitMaxSec: 600, responseTimeSec: 120 }, [1, 0]),
      cell(0, { percentCoverage: 0.8, revisitMaxSec: 300, responseTimeSec: null }, [1, 1]),
    ];
    const s = summarizeCoverage(cells, 0.5, 2);
    expect(s.minPercentCoverage).toBeCloseTo(0.2);
    expect(s.maxPercentCoverage).toBeCloseTo(0.8);
    expect(s.meanPercentCoverage).toBeCloseTo(0.5);
    expect(s.worstRevisitMaxSec).toBe(600);
    expect(s.worstResponseTimeSec).toBe(120); // null cell excluded
    expect(s.nFoldK).toBe(2);
    expect(s.nFoldCellFraction).toBeCloseTo(0.5); // one of two cells reaches k=2
  });

  it('excludes never-accessed cells from the worst response time (null -> omitted)', () => {
    const s = summarizeCoverage([cell(0, { responseTimeSec: null })], 0, 1);
    expect(s.worstResponseTimeSec).toBeNull();
  });
});

describe('coverageMetric registry', () => {
  it('resolves each id to its descriptor with a label and unit', () => {
    for (const id of ['percentCoverage', 'revisitMax', 'revisitMean', 'responseTime', 'meanAccessDuration', 'nFold'] as const) {
      expect(coverageMetric(id).id).toBe(id);
      expect(coverageMetric(id).label.length).toBeGreaterThan(0);
    }
  });
});
