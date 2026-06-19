// Coverage FOM reduction (against hand-built interval sets) and Walker generation
// (against the structural spacing rules). Pure, no SPICE. (STK_PARITY_SPEC §4.4.)

import { describe, it, expect } from 'vitest';
import type { Window } from '@bessel/timeline';
import { figureOfMerit, walkerConstellation } from './index.ts';

const TWO_PI = Math.PI * 2;

describe('figureOfMerit', () => {
  it('reduces a hand-built window to exact statistics', () => {
    // Span [0, 100]; covered on [10,20] and [40,70] -> 40% coverage, 2 accesses.
    const w: Window = [
      [10, 20],
      [40, 70],
    ];
    const fom = figureOfMerit(w, [0, 100]);
    expect(fom.percentCoverage).toBeCloseTo(0.4, 9);
    expect(fom.accessCount).toBe(2);
    // Gaps are [0,10],[20,40],[70,100] -> lengths 10,20,30.
    expect(fom.maxGapSec).toBe(30);
    expect(fom.meanGapSec).toBeCloseTo(20, 9);
    expect(fom.timeToFirstSec).toBe(10);
  });

  it('reports full coverage and never-covered correctly', () => {
    expect(figureOfMerit([[0, 100]], [0, 100]).percentCoverage).toBeCloseTo(1, 9);
    expect(figureOfMerit([[0, 100]], [0, 100]).maxGapSec).toBe(0);
    const never = figureOfMerit([], [0, 100]);
    expect(never.percentCoverage).toBe(0);
    expect(never.timeToFirstSec).toBeNull();
    expect(never.maxGapSec).toBe(100);
  });
});

describe('walkerConstellation', () => {
  it('builds a Walker Delta 53:24/3/1 with correct plane and phase spacing', () => {
    const sats = walkerConstellation({
      a: 7000,
      e: 0,
      i: 53 * (Math.PI / 180),
      argp: 0,
      totalSats: 24,
      planes: 3,
      phasing: 1,
    });
    expect(sats).toHaveLength(24);

    // Three planes, RAAN spaced 360/3 = 120 deg.
    const raans = [...new Set(sats.map((s) => Math.round((s.raan * 180) / Math.PI)))].sort((a, b) => a - b);
    expect(raans).toEqual([0, 120, 240]);

    // 8 satellites per plane, in-plane mean-anomaly spacing 360/8 = 45 deg.
    const plane0 = sats.filter((s) => Math.round((s.raan * 180) / Math.PI) === 0);
    expect(plane0).toHaveLength(8);
    const m = plane0.map((s) => (s.m0 * 180) / Math.PI).sort((a, b) => a - b);
    expect(m[1]! - m[0]!).toBeCloseTo(45, 6);

    // Inter-plane phasing F=1: first sat of plane 1 is offset by 360*1/24 = 15 deg.
    const firstP0 = sats[0]!;
    const firstP1 = sats[8]!;
    expect(((firstP1.m0 - firstP0.m0) * 180) / Math.PI).toBeCloseTo(15, 6);
  });

  it('a Walker Star spreads RAAN over pi', () => {
    const sats = walkerConstellation({ a: 7000, e: 0, i: 1.5, argp: 0, totalSats: 4, planes: 2, phasing: 0, pattern: 'star' });
    const raans = sats.map((s) => s.raan).filter((_, idx) => idx % 2 === 0);
    expect(raans[1]! - raans[0]!).toBeCloseTo(Math.PI / 2, 6); // pi / 2 planes
  });

  it('rejects T not divisible by P', () => {
    expect(() => walkerConstellation({ a: 7000, e: 0, i: 1, argp: 0, totalSats: 10, planes: 3, phasing: 1 })).toThrow();
  });
});
