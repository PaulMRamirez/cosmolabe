// @bessel/coverage: constellation generation and Figure-of-Merit reduction. The
// FOM reduces a point's access Window to coverage statistics; Walker generation
// builds a constellation's element sets. Pure (operates on windows/elements);
// the full grid sweep lives atop @bessel/access. (STK_PARITY_SPEC §4.4.)

import { windowCard, windowComplement, windowMeasure, type EphemerisTime, type Window } from '@bessel/timeline';
import type { ClassicalElements } from '@bessel/propagator';

const TWO_PI = Math.PI * 2;

/** Coverage statistics for one ground point over an analysis span. */
export interface FigureOfMerit {
  /** Covered fraction of the span, in [0, 1]. */
  readonly percentCoverage: number;
  /** Number of distinct access intervals. */
  readonly accessCount: number;
  /** Mean gap (s) between accesses within the span; 0 if always covered. */
  readonly meanGapSec: number;
  /** Longest coverage gap (s) within the span. */
  readonly maxGapSec: number;
  /** Time (s) from span start to first access; 0 if covered at the start, null if never. */
  readonly timeToFirstSec: number | null;
}

/** Reduce a point's access window over [t0, t1] to a Figure of Merit. */
export function figureOfMerit(window: Window, span: readonly [EphemerisTime, EphemerisTime]): FigureOfMerit {
  const [t0, t1] = span;
  const duration = t1 - t0;
  const gaps = windowComplement(t0, t1, window);
  const gapLengths = gaps.map(([s, e]) => e - s);
  const maxGapSec = gapLengths.length ? Math.max(...gapLengths) : 0;
  const meanGapSec = gapLengths.length ? gapLengths.reduce((a, b) => a + b, 0) / gapLengths.length : 0;
  const first = window[0];
  const timeToFirstSec = window.length === 0 ? null : Math.max(0, first![0] - t0);
  return {
    percentCoverage: duration > 0 ? windowMeasure(window) / duration : 0,
    accessCount: windowCard(window),
    meanGapSec,
    maxGapSec,
    timeToFirstSec,
  };
}

/** Walker constellation parameters: i:T/P/F about a shared base orbit. */
export interface WalkerParams {
  /** Semi-major axis (km). */
  readonly a: number;
  readonly e: number;
  /** Inclination (rad). */
  readonly i: number;
  /** Argument of periapsis (rad) shared by all satellites. */
  readonly argp: number;
  /** Total satellites T. */
  readonly totalSats: number;
  /** Orbital planes P (must divide T). */
  readonly planes: number;
  /** Inter-plane phasing parameter F, integer in [0, P-1]. */
  readonly phasing: number;
  /** RAAN of the first plane (rad); the planes span 2pi for Delta, pi for Star. */
  readonly raan0?: number;
  /** 'delta' spreads RAAN over 2pi (default); 'star' over pi. */
  readonly pattern?: 'delta' | 'star';
  readonly epoch?: EphemerisTime;
}

/**
 * Generate a Walker Delta/Star constellation's element sets: RAAN spaced evenly
 * across planes, mean anomaly spaced within a plane, with inter-plane phasing.
 */
export function walkerConstellation(p: WalkerParams): ClassicalElements[] {
  if (p.totalSats % p.planes !== 0) {
    throw new Error(`Walker T (${p.totalSats}) must be divisible by P (${p.planes})`);
  }
  const perPlane = p.totalSats / p.planes;
  const raanSpan = (p.pattern ?? 'delta') === 'star' ? Math.PI : TWO_PI;
  const raan0 = p.raan0 ?? 0;
  const epoch = p.epoch ?? 0;
  const out: ClassicalElements[] = [];
  for (let plane = 0; plane < p.planes; plane++) {
    const raan = raan0 + (raanSpan * plane) / p.planes;
    for (let s = 0; s < perPlane; s++) {
      const m0 =
        (TWO_PI * s) / perPlane + (TWO_PI * p.phasing * plane) / p.totalSats;
      out.push({ a: p.a, e: p.e, i: p.i, raan: raan % TWO_PI, argp: p.argp, m0: m0 % TWO_PI, epoch });
    }
  }
  return out;
}
