// Coverage FOM reduction (against hand-built interval sets) and Walker generation
// (against the structural spacing rules). Pure, no SPICE. (STK_PARITY_SPEC §4.4.)

import { describe, it, expect } from 'vitest';
import type { Window } from '@bessel/timeline';
import { figureOfMerit, figureOfMeritStats, FigureOfMeritError, walkerConstellation } from './index.ts';

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

  it('surfaces the richer additive stats on the merged FOM', () => {
    // Same hand-built window as above: [10,20],[40,70] over [0,100].
    const fom = figureOfMerit(
      [
        [10, 20],
        [40, 70],
      ],
      [0, 100],
    );
    // Durations 10 and 30: mean 20, max 30.
    expect(fom.meanAccessDurationSec).toBeCloseTo(20, 9);
    expect(fom.maxAccessDurationSec).toBe(30);
    // One interior gap (between stop 20 and start 40) of length 20.
    expect(fom.revisitMaxSec).toBe(20);
    expect(fom.revisitMeanSec).toBeCloseTo(20, 9);
    // Response time = (leadIn^2 + sum interior gap^2) / (2*span)
    //              = (10^2 + 20^2) / (2*100) = 500/200 = 2.5.
    expect(fom.responseTimeSec).toBeCloseTo(2.5, 9);
  });
});

describe('figureOfMeritStats', () => {
  it('computes durations, revisit gaps, and response time for a three-access set', () => {
    // Window [10,15],[35,55],[60,90] over [0,100].
    const w: Window = [
      [10, 15],
      [35, 55],
      [60, 90],
    ];
    const s = figureOfMeritStats(w, [0, 100]);
    // Durations 5, 20, 30: sum 55, mean 55/3, max 30.
    expect(s.meanAccessDurationSec).toBeCloseTo(55 / 3, 9);
    expect(s.maxAccessDurationSec).toBe(30);
    // Interior gaps: 35-15=20 and 60-55=5. Max 20, mean (20+5)/2 = 12.5.
    expect(s.revisitMaxSec).toBe(20);
    expect(s.revisitMeanSec).toBeCloseTo(12.5, 9);
    // Response time: leadIn=10, interior gaps 20 and 5.
    // (10^2 + 20^2 + 5^2) / (2*100) = (100+400+25)/200 = 525/200 = 2.625.
    expect(s.responseTimeSec).toBeCloseTo(2.625, 9);
  });

  it('handles a single access (no interior revisit gap) and never-covered', () => {
    // Single access [40,60] over [0,100]: no interior gaps, only the lead-in.
    const single = figureOfMeritStats([[40, 60]], [0, 100]);
    expect(single.meanAccessDurationSec).toBe(20);
    expect(single.maxAccessDurationSec).toBe(20);
    expect(single.revisitMaxSec).toBe(0);
    expect(single.revisitMeanSec).toBe(0);
    // Only the lead-in contributes: 40^2 / (2*100) = 1600/200 = 8.
    expect(single.responseTimeSec).toBeCloseTo(8, 9);

    // Covered from the start: lead-in is 0, so response time is 0.
    const fromStart = figureOfMeritStats([[0, 30]], [0, 100]);
    expect(fromStart.responseTimeSec).toBe(0);

    const never = figureOfMeritStats([], [0, 100]);
    expect(never.meanAccessDurationSec).toBe(0);
    expect(never.maxAccessDurationSec).toBe(0);
    expect(never.revisitMaxSec).toBe(0);
    expect(never.revisitMeanSec).toBe(0);
    expect(never.responseTimeSec).toBeNull();
  });

  it('fails loudly on a non-increasing span', () => {
    expect(() => figureOfMeritStats([[1, 2]], [10, 10])).toThrow(FigureOfMeritError);
    expect(() => figureOfMeritStats([[1, 2]], [10, 5])).toThrow(FigureOfMeritError);
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
