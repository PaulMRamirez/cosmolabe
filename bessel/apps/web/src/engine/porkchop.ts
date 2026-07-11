// The Lambert porkchop sweep (analysis-UX Phase 2, design section 3 tab 1): a pure, CPU-bound
// grid solve of the two-body boundary-value problem over a departure-epoch RANGE crossed with a
// time-of-flight RANGE. At each (departure, TOF) node it samples the departure and arrival body
// states (supplied, so the sweep is SPICE-free and unit-testable), solves Lambert about the
// central body, and records the departure delta-v (|v1 - v_departure_body|). The result carries
// the full grid for a contour heatmap plus the minimum-delta-v node for the "send to MCS" hop.
//
// Kept pure and bounded: the caller pre-samples the body states (so no spkezr in the hot loop)
// and chooses a modest grid; this module is the tested geometry over @bessel/mission lambert.

import { lambert, type Vec3 } from '@bessel/mission';

/** A pre-sampled body state (km, km/s) about the central body at one grid epoch. */
export interface SampledState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** The configurable porkchop grid: a departure-epoch range and a time-of-flight range, each a
 *  closed interval sampled at a fixed count (>= 2). Epochs are ET seconds; TOFs are seconds. */
export interface PorkchopGrid {
  /** Departure epochs (ET s), strictly increasing, length = departure samples (>= 2). */
  readonly departureEt: readonly number[];
  /** Times of flight (s), strictly increasing, length = TOF samples (>= 2). */
  readonly tofSec: readonly number[];
}

/** Optional sweep options: a progress hook fired after each departure column finishes (done = i + 1,
 *  total = departure samples), so the worker can yield progress from one sweep call. Does not affect
 *  the result; absent on the synchronous path. (analysis-UX Phase 3 porkchop worker-ization.) */
export interface SweepOptions {
  readonly onProgress?: (done: number, total: number) => void;
}

/** One solved grid node: the departure delta-v (km/s) at a (departure, TOF) pair, or null when
 *  Lambert did not converge (a degenerate/unsolvable node), so the contour can show a gap. */
export interface PorkchopNode {
  readonly departureIndex: number;
  readonly tofIndex: number;
  readonly departureEt: number;
  readonly tofSec: number;
  /** Departure delta-v magnitude (km/s), or null when the node has no Lambert solution. */
  readonly deltaVKmS: number | null;
}

/** The full porkchop result: the grid axes, every solved node (row-major over departure x TOF),
 *  the finite delta-v range for the contour legend, and the minimum-delta-v node (the marked
 *  optimum) with its solved departure velocity, or null when no node converged. */
export interface PorkchopResult {
  readonly departureEt: readonly number[];
  readonly tofSec: readonly number[];
  readonly nodes: readonly PorkchopNode[];
  /** Min/max finite delta-v over the grid (km/s), for the heatmap color scale. */
  readonly minDeltaVKmS: number;
  readonly maxDeltaVKmS: number;
  /** The minimum-delta-v node and its solved departure velocity (km/s), or null. */
  readonly best: PorkchopBest | null;
  readonly label: string;
}

/** The marked minimum-delta-v node plus the burn vector the "send to MCS" hop consumes. */
export interface PorkchopBest {
  readonly departureIndex: number;
  readonly tofIndex: number;
  readonly departureEt: number;
  readonly tofSec: number;
  readonly deltaVKmS: number;
  /** Solved heliocentric departure velocity (km/s). */
  readonly departureVelocity: Vec3;
  /** The departure delta-v vector (km/s): v1 minus the departure body's velocity. */
  readonly departureDeltaV: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mag = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** Build a closed-interval sample axis of `count` (>= 2) strictly increasing values from `lo`
 *  to `hi`. Fails loud when the range is empty or the count is below two (an unsweepable axis). */
export function linspace(lo: number, hi: number, count: number): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error(`porkchop: non-finite axis bound (lo=${lo}, hi=${hi})`);
  }
  if (count < 2) throw new Error(`porkchop: axis needs >= 2 samples, got ${count}`);
  if (hi <= lo) throw new Error(`porkchop: axis range must increase (lo=${lo}, hi=${hi})`);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(lo + ((hi - lo) * i) / (count - 1));
  return out;
}

/**
 * Sweep the porkchop grid: for each departure epoch (outer) and time of flight (inner), solve
 * Lambert about `mu` from the departure body state at that epoch to the arrival body state at
 * departure + TOF, and record the departure delta-v (|v1 - departure body velocity|). The body
 * states are supplied per axis (`departureStates` aligned to `grid.departureEt`; `arrivalStates`
 * a departure-major, TOF-minor matrix) so the sweep is pure and SPICE-free. Nodes that fail to
 * converge are recorded with a null delta-v (a contour gap) rather than aborting the whole grid.
 */
export function sweepPorkchop(
  grid: PorkchopGrid,
  mu: number,
  departureStates: readonly SampledState[],
  arrivalStates: readonly (readonly SampledState[])[],
  label: string,
  options: SweepOptions = {},
): PorkchopResult {
  const nd = grid.departureEt.length;
  const nt = grid.tofSec.length;
  if (nd < 2 || nt < 2) throw new Error(`porkchop: grid needs >= 2x2 nodes, got ${nd}x${nt}`);
  if (departureStates.length !== nd) {
    throw new Error(`porkchop: departureStates length ${departureStates.length} != ${nd}`);
  }
  if (arrivalStates.length !== nd) {
    throw new Error(`porkchop: arrivalStates rows ${arrivalStates.length} != ${nd}`);
  }
  if (!(mu > 0)) throw new Error(`porkchop: mu must be positive, got ${mu}`);

  const nodes: PorkchopNode[] = [];
  let min = Infinity;
  let max = -Infinity;
  let best: PorkchopBest | null = null;

  for (let i = 0; i < nd; i++) {
    const dep = departureStates[i]!;
    const arrRow = arrivalStates[i]!;
    if (arrRow.length !== nt) {
      throw new Error(`porkchop: arrivalStates row ${i} length ${arrRow.length} != ${nt}`);
    }
    for (let j = 0; j < nt; j++) {
      const departureEt = grid.departureEt[i]!;
      const tofSec = grid.tofSec[j]!;
      const arr = arrRow[j]!;
      let deltaVKmS: number | null = null;
      let v1: Vec3 | null = null;
      try {
        const sol = lambert(dep.position, arr.position, tofSec, mu);
        v1 = sol.v1;
        const dv = mag(sub(sol.v1, dep.velocity));
        if (Number.isFinite(dv)) deltaVKmS = dv;
      } catch {
        // A degenerate or non-converging node: leave it as a contour gap.
        deltaVKmS = null;
      }
      nodes.push({ departureIndex: i, tofIndex: j, departureEt, tofSec, deltaVKmS });
      if (deltaVKmS !== null && v1 !== null) {
        if (deltaVKmS < min) {
          min = deltaVKmS;
          best = {
            departureIndex: i,
            tofIndex: j,
            departureEt,
            tofSec,
            deltaVKmS,
            departureVelocity: v1,
            departureDeltaV: sub(v1, dep.velocity),
          };
        }
        if (deltaVKmS > max) max = deltaVKmS;
      }
    }
    // One departure column finished: yield progress so the worker can post a tick. The total is
    // the departure-sample count (the outer loop bound), advancing as each column completes.
    options.onProgress?.(i + 1, nd);
  }

  if (!best) throw new Error('porkchop: no grid node produced a Lambert solution');
  return {
    departureEt: grid.departureEt,
    tofSec: grid.tofSec,
    nodes,
    minDeltaVKmS: min,
    maxDeltaVKmS: Number.isFinite(max) ? max : min,
    best,
    label,
  };
}
