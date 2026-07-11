// SpiceWindow interval algebra: union/intersect/difference/complement/contract and
// measure mirror NAIF SpiceCell window semantics on hand-computed sets.

import { describe, it, expect } from 'vitest';
import {
  windowFromIntervals,
  windowInsert,
  windowMeasure,
  windowCard,
  windowContains,
  windowUnion,
  windowUnionAll,
  windowIntersect,
  windowIntersectAll,
  windowDifference,
  windowComplement,
  windowContract,
  type Window,
} from './window.ts';

describe('windowFromIntervals (normalize)', () => {
  it('sorts, drops reversed intervals, and merges overlapping and abutting', () => {
    const w = windowFromIntervals([
      [10, 12],
      [1, 3],
      [2, 4], // overlaps [1,3] -> [1,4]
      [4, 5], // abuts [1,4]    -> [1,5]
      [8, 7], // reversed, dropped
    ]);
    expect(w).toEqual([
      [1, 5],
      [10, 12],
    ]);
  });

  it('keeps degenerate singletons but never abutting duplicates', () => {
    expect(windowFromIntervals([[5, 5]])).toEqual([[5, 5]]);
  });
});

describe('windowMeasure / windowCard / windowContains', () => {
  const w: Window = [
    [0, 2],
    [5, 9],
  ];
  it('measures total covered duration', () => {
    expect(windowMeasure(w)).toBe(6);
    expect(windowCard(w)).toBe(2);
  });
  it('tests membership with inclusive endpoints', () => {
    expect(windowContains(w, 1)).toBe(true);
    expect(windowContains(w, 2)).toBe(true); // endpoint
    expect(windowContains(w, 3)).toBe(false);
    expect(windowContains(w, 5)).toBe(true);
    expect(windowContains(w, 10)).toBe(false);
  });
});

describe('windowUnion', () => {
  it('merges two overlapping windows', () => {
    const a: Window = [
      [1, 4],
      [7, 9],
    ];
    const b: Window = [
      [3, 5],
      [8, 10],
    ];
    expect(windowUnion(a, b)).toEqual([
      [1, 5],
      [7, 10],
    ]);
  });
  it('unionAll over many windows', () => {
    expect(windowUnionAll([[[0, 1]], [[2, 3]], [[1, 2]]])).toEqual([[0, 3]]);
  });
});

describe('windowIntersect', () => {
  it('keeps only the overlapping spans, dropping touch points', () => {
    const a: Window = [
      [1, 6],
      [8, 12],
    ];
    const b: Window = [
      [2, 3],
      [5, 9],
      [11, 20],
    ];
    expect(windowIntersect(a, b)).toEqual([
      [2, 3],
      [5, 6],
      [8, 9],
      [11, 12],
    ]);
  });
  it('abutting windows intersect to nothing (zero measure dropped)', () => {
    expect(windowIntersect([[1, 2]], [[2, 3]])).toEqual([]);
  });
  it('intersectAll ANDs a constraint stack', () => {
    const r = windowIntersectAll([
      [[0, 10]],
      [[2, 8]],
      [[3, 6]],
    ]);
    expect(r).toEqual([[3, 6]]);
  });

  it('intersectAll of an empty list returns the explicit domain (AND identity)', () => {
    expect(windowIntersectAll([], [0, 10])).toEqual([[0, 10]]);
  });

  it('intersectAll of an empty list with no domain throws (full domain is undefined)', () => {
    expect(() => windowIntersectAll([])).toThrow(/domain/);
  });
});

describe('windowDifference', () => {
  it('removes covered spans, splitting where needed', () => {
    const a: Window = [[0, 10]];
    const b: Window = [
      [2, 3],
      [5, 6],
    ];
    expect(windowDifference(a, b)).toEqual([
      [0, 2],
      [3, 5],
      [6, 10],
    ]);
  });
  it('difference of identical windows is empty', () => {
    const a: Window = [
      [1, 2],
      [4, 5],
    ];
    expect(windowDifference(a, a)).toEqual([]);
  });
});

describe('windowComplement', () => {
  it('returns the gaps within the domain', () => {
    const w: Window = [
      [2, 4],
      [6, 8],
    ];
    expect(windowComplement(0, 10, w)).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });
  it('complement of complement returns the window clipped to the domain', () => {
    const w: Window = [[2, 4]];
    const c = windowComplement(0, 10, w);
    expect(windowComplement(0, 10, c)).toEqual([[2, 4]]);
  });
});

describe('windowContract', () => {
  it('shrinks each interval and drops those that vanish', () => {
    const w: Window = [
      [0, 10],
      [12, 13], // width 1, contracting by 1 each side vanishes
    ];
    expect(windowContract(w, 1)).toEqual([[1, 9]]);
  });
  it('supports asymmetric left/right contraction', () => {
    expect(windowContract([[0, 10]], 2, 3)).toEqual([[2, 7]]);
  });
});

describe('windowInsert', () => {
  it('inserts and re-normalizes', () => {
    expect(windowInsert([[0, 2]], 1, 5)).toEqual([[0, 5]]);
  });
});
