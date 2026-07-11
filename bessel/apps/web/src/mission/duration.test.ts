// missionWindow insets both ends by a margin to keep sampled epochs inside SPK
// coverage. A short arc must not invert or collapse the window (which would feed NaN
// into the sampler): the margin is clamped to under half the span, and a non-positive
// span fails loudly with a typed, located error.

import { describe, it, expect } from 'vitest';
import { missionWindow, MissionWindowError } from './duration.ts';

describe('missionWindow', () => {
  it('insets both ends of a sufficiently long arc by the full margin', () => {
    expect(missionWindow(0, 10000, 1800)).toEqual([1800, 8200]);
  });

  it('clamps the margin under half the span for a short arc, keeping et0 < et1', () => {
    // Span 3600 with margin 1800 would collapse to a zero-width window; clamping keeps
    // a positive width.
    const [lo, hi] = missionWindow(0, 3600, 1800);
    expect(lo).toBeLessThan(hi);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(3600);

    // Span 100 (the synthetic generic-mission fixture) with margin 1800 still yields a
    // valid, non-inverted window.
    const [a, b] = missionWindow(0, 100, 1800);
    expect(a).toBeLessThan(b);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
  });

  it('throws a typed MissionWindowError for a non-positive span', () => {
    expect(() => missionWindow(0, 0, 1800)).toThrow(MissionWindowError);
    expect(() => missionWindow(200, 100, 1800)).toThrow(MissionWindowError);
  });

  it('reports the offending window in the error message', () => {
    try {
      missionWindow(500, 500, 1800);
      throw new Error('expected missionWindow to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissionWindowError);
      expect((err as Error).message).toContain('no positive span');
      expect((err as Error).message).toContain('500');
    }
  });
});
