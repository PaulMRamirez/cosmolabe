import { describe, it, expect } from 'vitest';
import {
  sortByEt,
  markerFraction,
  arcBoundaryAnnotations,
  type TimelineAnnotation,
} from './index.ts';

describe('@bessel/timeline annotations', () => {
  it('sorts by et without mutating the input', () => {
    const input: TimelineAnnotation[] = [
      { id: 'b', et: 20, label: 'b' },
      { id: 'a', et: 10, label: 'a' },
    ];
    const sorted = sortByEt(input);
    expect(sorted.map((a) => a.id)).toEqual(['a', 'b']);
    expect(input[0]!.id).toBe('b');
  });
  it('computes clamped marker fractions', () => {
    expect(markerFraction(0, 0, 100)).toBe(0);
    expect(markerFraction(50, 0, 100)).toBe(0.5);
    expect(markerFraction(100, 0, 100)).toBe(1);
    expect(markerFraction(-10, 0, 100)).toBe(0);
    expect(markerFraction(200, 0, 100)).toBe(1);
  });

  it('derives boundary annotations from trajectory arcs', () => {
    const anns = arcBoundaryAnnotations([
      { start: 100, stop: 200 },
      { start: 200, stop: 300 },
    ]);
    // Start of each arc plus one end marker.
    expect(anns.map((a) => a.et)).toEqual([100, 200, 300]);
    expect(anns[0]!.label).toBe('Mission start');
    expect(anns[0]!.kind).toBe('event');
    expect(anns[1]!.kind).toBe('maneuver');
    expect(anns[2]!.label).toBe('Mission end');
    // Markers land within [0,1] of the mission span.
    for (const a of anns) {
      const f = markerFraction(a.et, 100, 300);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('returns no annotations for an empty arc list', () => {
    expect(arcBoundaryAnnotations([])).toEqual([]);
  });
});
