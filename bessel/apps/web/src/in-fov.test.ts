// B22: the in-FOV tool's pure geometry: FOV half-angle from boundary rays, the
// off-boresight angle of a target from a nadir-pointed sensor, and intervals from a
// boolean sweep.

import { describe, it, expect } from 'vitest';
import { fovHalfAngleRad, nadirOffAngleRad, intervalsFromFlags } from './in-fov.ts';

const DEG = Math.PI / 180;

describe('fovHalfAngleRad', () => {
  it('is the largest off-boresight angle among the boundary rays', () => {
    // Boresight +z; four corner rays each tilted 10 deg off-axis.
    const t = Math.tan(10 * DEG);
    const half = fovHalfAngleRad(
      [0, 0, 1],
      [
        [t, t, 1],
        [-t, t, 1],
        [-t, -t, 1],
        [t, -t, 1],
      ],
    );
    // Corner of a 10 deg square half-angle is sqrt(2)*tan(10) off-axis.
    expect(half / DEG).toBeCloseTo((Math.atan(Math.SQRT2 * t) / DEG), 6);
  });

  it('is zero for a degenerate FOV with no bounds', () => {
    expect(fovHalfAngleRad([0, 0, 1], [])).toBe(0);
  });
});

describe('nadirOffAngleRad', () => {
  it('is zero when the target sits exactly along nadir (toward the center body)', () => {
    // Spacecraft at +z, center at origin, target below it: all colinear along nadir.
    const off = nadirOffAngleRad([0, 0, 100], [0, 0, 0], [0, 0, 0]);
    expect(off).toBeCloseTo(0, 9);
  });

  it('grows as the target moves off the nadir line', () => {
    // Center straight down (nadir = -z); a target 1 unit sideways at the same depth.
    const off = nadirOffAngleRad([0, 0, 100], [0, 0, 0], [100, 0, 0]);
    expect(off / DEG).toBeCloseTo(45, 6);
  });
});

describe('intervalsFromFlags', () => {
  it('builds contiguous in-view intervals and closes an open run at the last sample', () => {
    const times = [0, 60, 120, 180, 240];
    const flags = [false, true, true, false, true];
    expect(intervalsFromFlags(times, flags)).toEqual([
      [60, 120],
      [240, 240],
    ]);
  });

  it('returns nothing when never in view', () => {
    expect(intervalsFromFlags([0, 60], [false, false])).toEqual([]);
  });
});
