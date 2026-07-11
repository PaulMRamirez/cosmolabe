// N-fold coverage sweep: the per-cell k-fold-covered fraction must be computed by an O(M log M)
// endpoint sweep, not by enumerating every k-subset (2^N-1 per cell), which hung the worker on a
// real constellation. These tests pin both correctness on a small hand-checked case and that a
// large N (a 24-satellite constellation) returns immediately. (STK_PARITY_SPEC §4.4, COV-2/COV-3.)

import { describe, it, expect } from 'vitest';
import { windowFromIntervals, type EphemerisTime, type Window } from '@bessel/timeline';
import { nFoldFractions } from './grid-sweep.ts';

const span: readonly [EphemerisTime, EphemerisTime] = [0, 100];

describe('nFoldFractions', () => {
  it('counts simultaneous coverage on a hand-checked overlap', () => {
    // Three assets over [0,100]:
    //   A: [0,60]    B: [40,100]    C: [50,70]
    // >=1 covered: union [0,100] = 100  -> 1.0
    // >=2 covered: A&B [40,60] (20) + B&C [50,70] (20), overlap A&B&C [50,60] counted once at
    //              the >=2 level over the merged region [40,70] = 30 -> 0.30
    // >=3 covered: A&B&C [50,60] = 10 -> 0.10
    const a: Window = windowFromIntervals([[0, 60]]);
    const b: Window = windowFromIntervals([[40, 100]]);
    const c: Window = windowFromIntervals([[50, 70]]);
    const f = nFoldFractions([a, b, c], span);
    expect(f).toHaveLength(3);
    expect(f[0]!).toBeCloseTo(1.0, 12); // at least 1 asset
    expect(f[1]!).toBeCloseTo(0.3, 12); // at least 2 assets
    expect(f[2]!).toBeCloseTo(0.1, 12); // at least 3 assets
  });

  it('is monotonically non-increasing in k', () => {
    const windows: Window[] = [
      windowFromIntervals([[0, 50]]),
      windowFromIntervals([[10, 60]]),
      windowFromIntervals([[20, 80]]),
      windowFromIntervals([[30, 100]]),
    ];
    const f = nFoldFractions(windows, span);
    for (let k = 1; k < f.length; k++) expect(f[k]!).toBeLessThanOrEqual(f[k - 1]! + 1e-12);
  });

  it('returns zero everywhere when no two assets ever overlap', () => {
    const windows: Window[] = [
      windowFromIntervals([[0, 10]]),
      windowFromIntervals([[20, 30]]),
      windowFromIntervals([[40, 50]]),
    ];
    const f = nFoldFractions(windows, span);
    expect(f[0]!).toBeCloseTo(0.3, 12); // 30 s of single coverage out of 100
    expect(f[1]!).toBe(0); // never two at once
    expect(f[2]!).toBe(0);
  });

  it('returns immediately for a 24-asset constellation (no 2^N blowup)', () => {
    // 24 assets, each a single all-span interval: every instant is 24-fold covered. The old
    // subset enumeration would do 2^24-1 = 16.7M window operations per call; the sweep is linear.
    const n = 24;
    const windows: Window[] = Array.from({ length: n }, () => windowFromIntervals([[0, 100]]));
    const start = performance.now();
    const f = nFoldFractions(windows, span);
    const elapsedMs = performance.now() - start;
    expect(f).toHaveLength(n);
    for (let k = 0; k < n; k++) expect(f[k]!).toBeCloseTo(1.0, 12); // all 24 cover the whole span
    expect(elapsedMs).toBeLessThan(200); // would be many seconds with 2^24 subsets
  });
});
