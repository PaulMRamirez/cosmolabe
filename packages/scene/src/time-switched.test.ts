import { describe, expect, it } from 'vitest';
import { activeSegment } from './time-switched.ts';

const segments = [
  { start: 0, end: 10 },
  { start: 10, end: 20 },
  { start: 20, end: 30 },
];

describe('activeSegment', () => {
  it('selects the segment whose half-open interval contains et', () => {
    expect(activeSegment(segments, 5)).toBe(0);
    expect(activeSegment(segments, 10)).toBe(1);
    expect(activeSegment(segments, 25)).toBe(2);
  });

  it('treats the end of a segment as exclusive', () => {
    expect(activeSegment(segments, 20)).toBe(2);
    expect(activeSegment([{ start: 0, end: 10 }], 10)).toBe(-1);
  });

  it('returns -1 outside every segment', () => {
    expect(activeSegment(segments, -1)).toBe(-1);
    expect(activeSegment(segments, 30)).toBe(-1);
    expect(activeSegment([], 5)).toBe(-1);
  });
});
