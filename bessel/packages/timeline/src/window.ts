// SpiceWindow: an interval (time-window) algebra over EphemerisTime, mirroring the
// semantics of NAIF SpiceCell windows (wninsd/wnunid/wnintd/wndifd/wncomd/wncond/
// wnsumd). A window is a sorted, disjoint, non-abutting list of closed [start,stop]
// intervals with start <= stop. This is the shared substrate for access, lighting,
// coverage, conjunction, attitude, and sensor analysis (STK_PARITY_SPEC §3 F2).
//
// Pure and headless: no SPICE, no DOM. Validated by unit tests against hand-computed
// sets; once the GF routines are exported (F1), the same results are cross-checked
// against CSPICE wn* windows.

import { type EphemerisTime } from './index.ts';

/** A closed time interval [start, stop] with start <= stop (ET seconds). */
export type Interval = readonly [EphemerisTime, EphemerisTime];

/** A sorted, disjoint, non-abutting set of intervals. Build only via the helpers. */
export type Window = readonly Interval[];

/** The empty window. */
export const EMPTY: Window = [];

/**
 * Normalize raw intervals into a Window: drop reversed (stop < start) intervals,
 * sort by start, and merge overlapping or abutting intervals. Abutting intervals
 * ([a,b],[b,c]) merge to [a,c], matching NAIF wnunid.
 */
export function windowFromIntervals(intervals: Iterable<Interval>): Window {
  const valid = [...intervals].filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of valid) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e; // extend
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** Insert a single interval into a window (NAIF wninsd). */
export function windowInsert(window: Window, start: EphemerisTime, stop: EphemerisTime): Window {
  return windowFromIntervals([...window, [start, stop]]);
}

/** Total covered duration (NAIF wnsumd): the sum of interval lengths. */
export function windowMeasure(window: Window): number {
  let total = 0;
  for (const [s, e] of window) total += e - s;
  return total;
}

/** Number of intervals (NAIF cardinality wncard). */
export function windowCard(window: Window): number {
  return window.length;
}

/** True if the epoch lies within any interval (inclusive endpoints). */
export function windowContains(window: Window, et: EphemerisTime): boolean {
  for (const [s, e] of window) {
    if (et < s) return false; // sorted: no later interval can contain it
    if (et <= e) return true;
  }
  return false;
}

/** Union of two windows (NAIF wnunid). */
export function windowUnion(a: Window, b: Window): Window {
  return windowFromIntervals([...a, ...b]);
}

/** Union of many windows. */
export function windowUnionAll(windows: readonly Window[]): Window {
  return windowFromIntervals(windows.flat());
}

/** Intersection of two windows (NAIF wnintd). Zero-measure touch points are dropped. */
export function windowIntersect(a: Window, b: Window): Window {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i]!;
    const bj = b[j]!;
    const s = Math.max(ai[0], bj[0]);
    const e = Math.min(ai[1], bj[1]);
    if (e > s) out.push([s, e]); // strict: ignore measure-zero overlaps
    if (ai[1] < bj[1]) i++;
    else j++;
  }
  return out; // already sorted and disjoint
}

/**
 * Intersection of many windows (constraint AND). The AND identity is the full domain,
 * so an empty list returns `domain` (an explicit [lo, hi]) rather than EMPTY. Calling
 * with an empty list and no domain is a programming error (the full domain is undefined
 * without bounds) and throws loudly. A non-empty list ignores `domain`.
 */
export function windowIntersectAll(windows: readonly Window[], domain?: Interval): Window {
  if (windows.length === 0) {
    if (domain === undefined) {
      throw new Error('windowIntersectAll: empty list needs an explicit [lo, hi] domain (AND identity)');
    }
    return [domain];
  }
  return windows.reduce((acc, w) => windowIntersect(acc, w));
}

/** Difference a \ b (NAIF wndifd): the part of a not covered by b. */
export function windowDifference(a: Window, b: Window): Window {
  const out: Interval[] = [];
  for (const [s, e] of a) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue; // b interval entirely before the remaining part
      if (bs >= e) break; // b interval (and all later) start after this interval
      if (bs > cur) out.push([cur, Math.min(bs, e)]);
      cur = Math.max(cur, be);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
}

/** Complement of a window within the domain [lo, hi] (NAIF wncomd). */
export function windowComplement(lo: EphemerisTime, hi: EphemerisTime, window: Window): Window {
  return windowDifference([[lo, hi]], window);
}

/**
 * Contract each interval (NAIF wncond): shrink the start by `left` and the stop by
 * `right` (default `right = left`); intervals that vanish or invert are dropped.
 * Negative amounts expand (and may then merge).
 */
export function windowContract(window: Window, left: number, right: number = left): Window {
  return windowFromIntervals(window.map(([s, e]): Interval => [s + left, e - right]));
}
