// Pure helpers for the COVERAGE & CONSTELLATION workflow: the selectable figure-of-merit
// metric registry (how a swept cell reduces to a color scalar, with its label and units),
// the Walker-element-set to orbit-ring geometry conversion (so a designed constellation
// renders as rings AND becomes the swept asset set), and the regional FOM summary + its CSV.
// Pure (no SPICE, no engine, no store), so each piece is unit tested in isolation and the
// metric->colormap mapping and the asset-set-from-Walker are verifiable without a worker.

import type { CoverageCell, FigureOfMerit } from '@bessel/coverage';
import type { ClassicalElements } from '@bessel/propagator';
import type { Km3 } from '@bessel/scene';

/** The selectable figure-of-merit metric a coverage contour can color by. */
export type CoverageMetricId =
  | 'percentCoverage'
  | 'revisitMax'
  | 'revisitMean'
  | 'responseTime'
  | 'meanAccessDuration'
  | 'nFold';

/** A metric descriptor: how a cell reduces to a raw value, its display, and the
 *  normalization that maps the raw value into the colormap's [0, 1] domain. A higher
 *  normalized scalar always reads as "better" (more yellow) so the legend is consistent:
 *  coverage maps directly, while the gap/latency metrics invert (a short revisit is good). */
export interface CoverageMetric {
  readonly id: CoverageMetricId;
  readonly label: string;
  /** Unit string for the legend (empty for a dimensionless fraction shown as a percent). */
  readonly unit: string;
  /** Whether the raw value is a fraction the panel shows as a percent (x100). */
  readonly isFraction: boolean;
  /** Reduce a swept cell to the metric's raw value. `k` is the 1-based N-fold order. */
  readonly raw: (cell: CoverageCell, k: number) => number;
  /** Whether a larger raw value is the worse outcome (so the colormap inverts it). */
  readonly higherIsWorse: boolean;
}

/** The N-fold k-th order coverage fraction (>= k simultaneous assets), 0 when out of range. */
function nFoldAt(cell: CoverageCell, k: number): number {
  return cell.nFoldCoverage[Math.max(1, Math.floor(k)) - 1] ?? 0;
}

/** The metric registry, keyed by id. Adding a metric is one entry here plus a form option. */
export const COVERAGE_METRICS: Readonly<Record<CoverageMetricId, CoverageMetric>> = {
  percentCoverage: { id: 'percentCoverage', label: '% coverage', unit: '%', isFraction: true, higherIsWorse: false, raw: (c) => c.fom.percentCoverage },
  revisitMax: { id: 'revisitMax', label: 'Max revisit gap', unit: 'min', isFraction: false, higherIsWorse: true, raw: (c) => c.fom.revisitMaxSec / 60 },
  revisitMean: { id: 'revisitMean', label: 'Mean revisit gap', unit: 'min', isFraction: false, higherIsWorse: true, raw: (c) => c.fom.revisitMeanSec / 60 },
  responseTime: { id: 'responseTime', label: 'Mean response time', unit: 'min', isFraction: false, higherIsWorse: true, raw: (c) => (c.fom.responseTimeSec ?? Infinity) / 60 },
  meanAccessDuration: { id: 'meanAccessDuration', label: 'Mean access duration', unit: 'min', isFraction: false, higherIsWorse: false, raw: (c) => c.fom.meanAccessDurationSec / 60 },
  nFold: { id: 'nFold', label: 'N-fold coverage', unit: '%', isFraction: true, higherIsWorse: false, raw: (c, k) => nFoldAt(c, k) },
};

/** Resolve a metric id to its descriptor, falling back to percentCoverage. */
export function coverageMetric(id: CoverageMetricId): CoverageMetric {
  return COVERAGE_METRICS[id] ?? COVERAGE_METRICS.percentCoverage;
}

/**
 * Normalize each cell's raw metric value to the [0, 1] colormap scalar, where 1 always
 * reads as the best outcome. A fraction metric ([0, 1] already) maps directly (and would
 * invert to 1 - x for a higher-is-worse fraction, though none is). An unbounded metric
 * (gaps, durations) min/max scales across the finite cell values, then inverts for
 * higher-is-worse so a short revisit gap is bright. A degenerate range (all equal, or no
 * finite values) maps every cell to 1 so the overlay is not all dark-violet. A non-finite
 * raw (e.g. a never-accessed cell's response time) is the worst case (0). Pure: depends
 * only on the cell values and k.
 */
export function metricScalars(
  cells: readonly CoverageCell[],
  metric: CoverageMetric,
  k: number,
): number[] {
  const raws = cells.map((c) => metric.raw(c, k));
  if (metric.isFraction) {
    return raws.map((r) => {
      const v = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
      return metric.higherIsWorse ? 1 - v : v;
    });
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const r of raws) {
    if (!Number.isFinite(r)) continue;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-12) {
    // A degenerate range (all finite values equal, or none finite): the finite cells are
    // uniformly "best" (1); a non-finite cell stays the worst case (0).
    return raws.map((r) => (Number.isFinite(r) ? 1 : 0));
  }
  return raws.map((r) => {
    if (!Number.isFinite(r)) return 0;
    const t = (r - min) / (max - min);
    return metric.higherIsWorse ? 1 - t : t;
  });
}

/** Earth-radius constant for the Walker base orbit (a = Re + altitude). Published WGS-84. */
const EARTH_RADIUS_KM = 6378.137;

/** The Walker base semi-major axis (km) from an altitude above the Earth's surface. */
export function walkerSemiMajorAxisKm(altitudeKm: number): number {
  return EARTH_RADIUS_KM + altitudeKm;
}

/** A circular two-body state in J2000 (body-centered km, km/s) at a position angle. */
export interface WalkerState {
  readonly pos: Km3;
  readonly vel: Km3;
}

/**
 * Circular two-body state of a Walker element set at position angle `theta` (rad, measured
 * from the ascending node, argp folded in by the caller): radius a, speed a*n, rotated into
 * J2000 by the inclination then the RAAN. The shared kernel both the asset publisher and the
 * orbit rings use, so the asset states and the rings come from one math path. Pure: trig only.
 */
export function walkerStateAt(el: ClassicalElements, n: number, theta: number): WalkerState {
  const a = el.a;
  const speed = a * n;
  const cosI = Math.cos(el.i);
  const sinI = Math.sin(el.i);
  const cosO = Math.cos(el.raan);
  const sinO = Math.sin(el.raan);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  // Perifocal position (a*[ct,st,0]) and velocity (speed*[-st,ct,0]), rotated by i then RAAN.
  const rotate = (px: number, py: number): Km3 => {
    const yi = py * cosI;
    const zi = py * sinI;
    return [px * cosO - yi * sinO, px * sinO + yi * cosO, zi];
  };
  return { pos: rotate(a * ct, a * st), vel: rotate(-speed * st, speed * ct) };
}

/** Mean motion (rad/s) of a circular orbit of semi-major axis a under gravity mu. */
export function meanMotion(a: number, mu: number): number {
  return Math.sqrt(mu / (a * a * a));
}

/** The regional aggregate FOM summary the panel renders as a table and exports as CSV. */
export interface CoverageFomSummary {
  readonly cellCount: number;
  /** Area-weighted mean percent coverage across the region, in [0, 1]. */
  readonly areaWeightedPercentCoverage: number;
  /** Min/mean/max percent coverage (fraction) over the cells. */
  readonly minPercentCoverage: number;
  readonly meanPercentCoverage: number;
  readonly maxPercentCoverage: number;
  /** Worst-cell longest revisit gap (s) across cells. */
  readonly worstRevisitMaxSec: number;
  /** Worst-cell mean response time (s); null when no cell is ever accessed. */
  readonly worstResponseTimeSec: number | null;
  /** Fraction of cells reaching the requested N-fold k (>= k assets at some instant). */
  readonly nFoldCellFraction: number;
  /** The N-fold order k the summary was computed for. */
  readonly nFoldK: number;
}

/**
 * Aggregate a swept cell list into the regional FOM summary: coverage min/mean/max, the
 * worst revisit and response time, and the fraction of cells meeting the N-fold order k.
 * `areaWeighted` is passed through from the sweep (it carries the cos-lat weighting). The
 * per-metric means stay available as the colored cell metrics. Pure: depends only on the
 * cells, k, and the area-weighted value.
 */
export function summarizeCoverage(
  cells: readonly CoverageCell[],
  areaWeighted: number,
  k: number,
): CoverageFomSummary {
  const foms: FigureOfMerit[] = cells.map((c) => c.fom);
  const cov = foms.map((f) => f.percentCoverage);
  const responses = foms.map((f) => f.responseTimeSec).filter((r): r is number => r !== null);
  const order = Math.max(1, Math.floor(k));
  const nFoldHits = cells.filter((c) => (c.nFoldCoverage[order - 1] ?? 0) > 0).length;
  return {
    cellCount: cells.length,
    areaWeightedPercentCoverage: areaWeighted,
    minPercentCoverage: cov.length ? Math.min(...cov) : 0,
    meanPercentCoverage: cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : 0,
    maxPercentCoverage: cov.length ? Math.max(...cov) : 0,
    worstRevisitMaxSec: foms.length ? Math.max(...foms.map((f) => f.revisitMaxSec)) : 0,
    worstResponseTimeSec: responses.length ? Math.max(...responses) : null,
    nFoldCellFraction: cells.length ? nFoldHits / cells.length : 0,
    nFoldK: order,
  };
}
