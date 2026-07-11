// [ux-p3-conjunction] The watchlist reducer is pure, so the trend logic (rose/fell/unchanged/new),
// the order-independent pair key, and the watch/update/unwatch/clear transitions are tested directly.

import { describe, it, expect } from 'vitest';
import {
  INITIAL_WATCHLIST,
  reduceWatchlist,
  pairKey,
  isWatched,
  type WatchlistState,
} from './watchlist.ts';

const watch = (s: WatchlistState, a: string, b: string, pc: number | null, miss: number): WatchlistState =>
  reduceWatchlist(s, { type: 'watch', primaryId: a, secondaryId: b, pc, missKm: miss });

describe('pairKey', () => {
  it('is order-independent (same key for either screen order)', () => {
    expect(pairKey('A', 'B')).toBe(pairKey('B', 'A'));
  });
});

describe('reduceWatchlist', () => {
  it('watch adds a new tracked row with the new trend', () => {
    const s = watch(INITIAL_WATCHLIST, 'SAT-A', 'DEB-B', 1e-4, 0.3);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ primaryId: 'SAT-A', secondaryId: 'DEB-B', pc: 1e-4, trend: 'new' });
  });

  it('update sets trend "fell" when the Pc drops, "rose" when it climbs', () => {
    const seeded = watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3);
    const fell = reduceWatchlist(seeded, { type: 'update', primaryId: 'A', secondaryId: 'B', pc: 1e-6, missKm: 5 });
    expect(fell.rows[0]).toMatchObject({ pc: 1e-6, missKm: 5, trend: 'fell' });
    const rose = reduceWatchlist(fell, { type: 'update', primaryId: 'B', secondaryId: 'A', pc: 2e-6, missKm: 4 });
    // Order-independent update reaches the same row.
    expect(rose.rows[0]).toMatchObject({ pc: 2e-6, trend: 'rose' });
  });

  it('update is a no-op for an untracked pair', () => {
    const seeded = watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3);
    const same = reduceWatchlist(seeded, { type: 'update', primaryId: 'X', secondaryId: 'Y', pc: 1, missKm: 1 });
    expect(same).toBe(seeded);
  });

  it('update with a null Pc reads as unchanged rather than a direction', () => {
    const seeded = watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3);
    const upd = reduceWatchlist(seeded, { type: 'update', primaryId: 'A', secondaryId: 'B', pc: null, missKm: 9 });
    expect(upd.rows[0]).toMatchObject({ pc: null, trend: 'unchanged' });
  });

  it('watching an already-tracked pair re-seeds it (no duplicate row)', () => {
    const once = watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3);
    const twice = watch(once, 'A', 'B', 5e-5, 0.5);
    expect(twice.rows).toHaveLength(1);
    expect(twice.rows[0]).toMatchObject({ pc: 5e-5, trend: 'new' });
  });

  it('unwatch removes the row by key; clear empties', () => {
    const s = watch(watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3), 'C', 'D', 1e-5, 1);
    const removed = reduceWatchlist(s, { type: 'unwatch', key: pairKey('A', 'B') });
    expect(removed.rows.map((r) => r.key)).toEqual([pairKey('C', 'D')]);
    expect(reduceWatchlist(removed, { type: 'clear' }).rows).toHaveLength(0);
  });
});

describe('isWatched', () => {
  it('is true for a tracked pair in either order, false otherwise', () => {
    const s = watch(INITIAL_WATCHLIST, 'A', 'B', 1e-4, 0.3);
    expect(isWatched(s, 'A', 'B')).toBe(true);
    expect(isWatched(s, 'B', 'A')).toBe(true);
    expect(isWatched(s, 'A', 'C')).toBe(false);
  });
});
