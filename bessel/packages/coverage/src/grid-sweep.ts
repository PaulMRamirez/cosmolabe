// Coverage grid-sweep over access. Builds a uniform lat/lon grid of ground points
// on a central body and, for each cell, reuses the @bessel/access single-(point,
// asset) elevation-access engine (do NOT duplicate it) to find the visibility
// window of a satellite, or the union over a constellation of satellites. Each cell
// is reduced to a Figure of Merit and an N-fold (number of simultaneous assets)
// count, giving a FOM grid the scene can contour. Worker-side and cancellable in the
// app; the core sweep is a plain async function here. (STK_PARITY_SPEC §4.4,
// COV-1/COV-2/COV-3.)

import { windowUnionAll, type EphemerisTime, type Window } from '@bessel/timeline';
import { computeElevationAccess, type Facility } from '@bessel/access';
import { JobCancelledError, type AberrationCorrection, type SpiceEngine } from '@bessel/spice';
import { figureOfMerit, type FigureOfMerit } from './index.ts';

/** A uniform lat/lon coverage grid over a central body. */
export interface GridSpec {
  /** Central body (e.g. "EARTH") and its body-fixed frame (e.g. "IAU_EARTH"). */
  readonly body: string;
  readonly bodyFrame: string;
  /** Inclusive latitude bounds (rad), south to north. */
  readonly latMin: number;
  readonly latMax: number;
  /** Number of latitude rows (>= 1). Row centers are evenly spaced in [latMin,latMax]. */
  readonly latCount: number;
  /** Inclusive longitude bounds (rad), west to east. */
  readonly lonMin: number;
  readonly lonMax: number;
  /** Number of longitude columns (>= 1). */
  readonly lonCount: number;
  /** Cell altitude above the ellipsoid (km), default 0. */
  readonly altKm?: number;
}

export interface GridSweepRequest {
  readonly grid: GridSpec;
  /** Asset SPK ids/names; the cell sees coverage when any asset is in view (1-fold). */
  readonly assets: readonly string[];
  /** Search span [start, stop] in ET seconds. */
  readonly span: readonly [EphemerisTime, EphemerisTime];
  /** Geometry-finder step (s); must be shorter than the briefest pass. */
  readonly step: number;
  /** Minimum elevation above the local horizon (rad) for a pass to count. */
  readonly minElevationRad: number;
  readonly abcorr?: AberrationCorrection;
  /** Optional monotonic progress callback in [0,1] over the swept cells. */
  readonly onProgress?: (fraction: number) => void;
  /**
   * Optional per-cell callback fired as each cell completes, in row-major
   * order, carrying the cell payload. The compute plane (M-0004) streams
   * field partials from this hook; onProgress remains fraction-only.
   */
  readonly onCell?: (cell: CoverageCell, done: number, total: number) => void;
  /**
   * Optional cooperative cancellation, checked between cells. When the signal
   * aborts, the sweep throws JobCancelledError rather than returning a
   * partial grid.
   */
  readonly signal?: AbortSignal;
}

/** One swept cell: its center, per-asset FOM, and N-fold simultaneous coverage. */
export interface CoverageCell {
  readonly latRad: number;
  readonly lonRad: number;
  readonly rowIndex: number;
  readonly colIndex: number;
  /** FOM of the any-asset (1-fold) union window. */
  readonly fom: FigureOfMerit;
  /**
   * N-fold coverage fraction[k] = fraction of the span covered by at least (k+1)
   * assets simultaneously, for k in [0, assets.length).
   */
  readonly nFoldCoverage: readonly number[];
}

/** The reduced FOM grid for the whole sweep. */
export interface CoverageGrid {
  readonly grid: GridSpec;
  /** Cells in row-major order (row by latitude ascending, column by longitude). */
  readonly cells: readonly CoverageCell[];
  /**
   * Area-weighted mean of percentCoverage across all cells (additive). On a uniform
   * lat/lon grid each cell subtends a spherical area proportional to cos(latCenter)
   * (the area element is cos(lat) dLat dLon), so high-latitude cells, which crowd
   * together on the sphere, are down-weighted relative to the equator. This corrects
   * the bias of the naive per-cell mean, which over-counts polar cells. 0 when the
   * grid has no positive-weight cells.
   */
  readonly areaWeightedPercentCoverage: number;
}

/**
 * Area-weighted mean of each cell's percentCoverage, weighting cell c by cos(lat_c)
 * (proportional to its spherical cell area on a uniform lat/lon grid). Pure: depends
 * only on cell centers and coverage. Negative cos weights (|lat| > 90 deg, which a
 * valid grid never produces) are clamped to 0. Returns 0 when the total weight is 0.
 */
export function areaWeightedPercentCoverage(cells: readonly CoverageCell[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const cell of cells) {
    const weight = Math.max(0, Math.cos(cell.latRad));
    weighted += weight * cell.fom.percentCoverage;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

/** A bad grid configuration (loud, located). */
export class GridSweepError extends Error {
  constructor(message: string) {
    super(`coverage grid sweep: ${message}`);
    this.name = 'GridSweepError';
  }
}

/** Center coordinate of cell index `k` of `count` evenly spaced across [min,max]. */
function cellCenter(min: number, max: number, count: number, k: number): number {
  if (count === 1) return (min + max) / 2;
  return min + ((max - min) * k) / (count - 1);
}

function validate(grid: GridSpec): void {
  if (grid.latCount < 1 || grid.lonCount < 1) {
    throw new GridSweepError(`latCount and lonCount must be >= 1 (got ${grid.latCount}, ${grid.lonCount})`);
  }
  if (grid.latMax < grid.latMin) throw new GridSweepError('latMax must be >= latMin');
  if (grid.lonMax < grid.lonMin) throw new GridSweepError('lonMax must be >= lonMin');
}

/**
 * Count the span fraction covered by at least 1..N assets simultaneously via a single
 * endpoint sweep. Each per-asset interval contributes a +1 at its start and a -1 at its
 * stop; sorting the 2*M endpoints and tracking a running cover-count gives, between any
 * two adjacent endpoints, exactly how many assets are simultaneously in view. The time
 * spent at cover-count >= k accumulates the k-fold duration. This is O(M log M) in the
 * total interval count M, replacing the old union-over-every-k-subset which was O(2^N)
 * per cell and hung the worker on a real constellation (e.g. 24 satellites). nFold[k] is
 * for "at least (k+1) assets". (Per-asset windows are already disjoint and sorted, so an
 * asset can contribute at most +1 to the live count at any instant.)
 */
export function nFoldFractions(
  perAsset: readonly Window[],
  span: readonly [EphemerisTime, EphemerisTime],
): number[] {
  const [t0, t1] = span;
  const duration = t1 - t0;
  const n = perAsset.length;
  // Accumulated duration at exactly each cover-count, atLeast[k] = time with >= k assets.
  const atLeast = new Float64Array(n + 1);
  if (duration <= 0 || n === 0) return new Array(n).fill(0) as number[];

  // Merge all interval endpoints into one delta stream, then sweep.
  type Endpoint = { t: number; delta: number };
  const endpoints: Endpoint[] = [];
  for (const w of perAsset) {
    for (const [a, b] of w) {
      if (b <= a) continue; // skip measure-zero / reversed
      endpoints.push({ t: a, delta: +1 });
      endpoints.push({ t: b, delta: -1 });
    }
  }
  // Sort by time; at a tie, apply stops (-1) before starts (+1) so two abutting intervals
  // do not momentarily over-count, and an interval boundary never double-counts.
  endpoints.sort((p, q) => (p.t === q.t ? p.delta - q.delta : p.t - q.t));

  let cover = 0;
  let prevT = endpoints.length ? endpoints[0]!.t : t0;
  for (const ep of endpoints) {
    if (ep.t > prevT && cover > 0) {
      const dt = ep.t - prevT;
      // The segment [prevT, ep.t] is covered by exactly `cover` assets, hence by
      // >= 1, >= 2, ..., >= cover assets.
      for (let k = 1; k <= cover; k++) atLeast[k]! += dt;
    }
    cover += ep.delta;
    prevT = ep.t;
  }

  const out: number[] = [];
  for (let k = 1; k <= n; k++) out.push(atLeast[k]! / duration);
  return out;
}

/**
 * Sweep the grid: for every cell, compute each asset's elevation-access window via
 * @bessel/access, reduce the any-asset union to a FOM, and accumulate the N-fold
 * coverage fractions. Returns the FOM grid in row-major order.
 */
export async function sweepCoverageGrid(
  spice: SpiceEngine,
  req: GridSweepRequest,
): Promise<CoverageGrid> {
  validate(req.grid);
  if (req.assets.length === 0) throw new GridSweepError('a sweep needs at least one asset');
  const [t0, t1] = req.span;
  if (t1 <= t0) throw new GridSweepError(`span must be increasing, got [${t0}, ${t1}]`);
  const g = req.grid;
  const cells: CoverageCell[] = [];
  const total = g.latCount * g.lonCount;
  let done = 0;

  for (let r = 0; r < g.latCount; r++) {
    const latRad = cellCenter(g.latMin, g.latMax, g.latCount, r);
    for (let c = 0; c < g.lonCount; c++) {
      if (req.signal?.aborted) throw new JobCancelledError();
      const lonRad = cellCenter(g.lonMin, g.lonMax, g.lonCount, c);
      const facility: Facility = {
        body: g.body,
        bodyFrame: g.bodyFrame,
        lonRad,
        latRad,
        altKm: g.altKm ?? 0,
      };
      const perAsset: Window[] = [];
      for (const asset of req.assets) {
        perAsset.push(
          await computeElevationAccess(spice, facility, asset, req.span, req.step, req.minElevationRad, req.abcorr),
        );
      }
      const anyAsset = windowUnionAll(perAsset);
      const fom = figureOfMerit(anyAsset, req.span);
      const nFoldCoverage = nFoldFractions(perAsset, req.span);
      const cell: CoverageCell = { latRad, lonRad, rowIndex: r, colIndex: c, fom, nFoldCoverage };
      cells.push(cell);
      done++;
      req.onCell?.(cell, done, total);
      req.onProgress?.(done / total);
    }
  }
  return { grid: g, cells, areaWeightedPercentCoverage: areaWeightedPercentCoverage(cells) };
}
