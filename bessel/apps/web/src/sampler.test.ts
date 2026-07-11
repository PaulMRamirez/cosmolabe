// Item 5 (relative speed): rangeRate is the line-of-sight component of relative
// velocity, negative when closing and positive when separating.

import { describe, it, expect } from 'vitest';
import { rangeRate, positionAt, velocityAt, type EphemerisTable } from './sampler.ts';

// A small straight-line table: one body moving along +x at a constant 2 km/s over
// [et0, et1], sampled at `steps` evenly spaced epochs.
function lineTable(et0: number, et1: number, steps: number, speed = 2): EphemerisTable {
  const times = new Float64Array(steps);
  const flat = new Float64Array(steps * 3);
  for (let k = 0; k < steps; k += 1) {
    const et = et0 + ((et1 - et0) * k) / (steps - 1 || 1);
    times[k] = et;
    flat[k * 3] = speed * (et - et0); // x = speed * elapsed
  }
  return { et0, et1, steps, times, byBody: new Map([['B', flat]]) };
}

describe('rangeRate', () => {
  it('is negative when two bodies approach head-on', () => {
    // a at +x moving -x, b at origin stationary: closing at 2 km/s.
    expect(rangeRate([10, 0, 0], [0, 0, 0], [-2, 0, 0], [0, 0, 0])).toBeCloseTo(-2, 6);
  });

  it('is positive when two bodies separate', () => {
    expect(rangeRate([10, 0, 0], [0, 0, 0], [3, 0, 0], [0, 0, 0])).toBeCloseTo(3, 6);
  });

  it('ignores transverse motion (no range change)', () => {
    // a at +x moving +y: distance unchanged to first order.
    expect(rangeRate([10, 0, 0], [0, 0, 0], [0, 5, 0], [0, 0, 0])).toBeCloseTo(0, 6);
  });

  it('returns 0 for coincident points', () => {
    expect(rangeRate([0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0])).toBe(0);
  });
});

describe('positionAt degenerate window', () => {
  it('returns the single sample (no 0/0 NaN) when et1 === et0', () => {
    // A collapsed window would otherwise divide by (et1 - et0) === 0.
    const flat = new Float64Array([7, 8, 9]);
    const table: EphemerisTable = {
      et0: 1000,
      et1: 1000,
      steps: 1,
      times: new Float64Array([1000]),
      byBody: new Map([['B', flat]]),
    };
    const p = positionAt(table, 'B', 1000);
    expect(p).toEqual([7, 8, 9]);
    expect(p.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('velocityAt at the window edge', () => {
  it('reports the true speed at et0 (not 2x) by dividing by the actual stencil span', () => {
    // Body moves at 2 km/s. The central difference at et0 collapses to a one-sided
    // stencil over [et0, et0+1]; dividing by 2 would report ~1 km/s. The fix divides
    // by the real 1 s span and recovers 2 km/s.
    const table = lineTable(0, 100, 101, 2);
    const v0 = velocityAt(table, 'B', 0);
    expect(v0[0]).toBeCloseTo(2, 6);
    expect(v0[1]).toBeCloseTo(0, 6);

    // The interior central difference is unaffected.
    const vMid = velocityAt(table, 'B', 50);
    expect(vMid[0]).toBeCloseTo(2, 6);

    // The far edge (et1) is also a one-sided stencil over [et1-1, et1].
    const vEnd = velocityAt(table, 'B', 100);
    expect(vEnd[0]).toBeCloseTo(2, 6);
  });
});
