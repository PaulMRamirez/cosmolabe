// TimeSwitched geometry (Cosmographia geometry type): exactly one of several
// segments is shown depending on the current epoch, for assets that change over a
// mission (phase markers, swapped models). The segment-selection logic is pure
// and unit-tested; the scene wraps each segment in a child object and toggles
// visibility each frame.

export interface TimeSegment {
  readonly start: number;
  readonly end: number;
}

/** Index of the segment whose [start, end) contains et, or -1 if none. */
export function activeSegment(segments: readonly TimeSegment[], et: number): number {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (et >= s.start && et < s.end) return i;
  }
  return -1;
}
