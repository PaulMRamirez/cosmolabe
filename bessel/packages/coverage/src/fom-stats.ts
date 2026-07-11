// Richer Figure-of-Merit statistics derived from an access Window over a span.
// These are additive to the base FigureOfMerit (percentCoverage, accessCount,
// maxGapSec, meanGapSec, timeToFirstSec) and never change their meaning; they add
// per-access duration stats, revisit (between-access) gap stats, and the mean
// response time. Pure (operates on the window and span only). (STK_PARITY_SPEC §4.4.)

import { type EphemerisTime, type Window } from '@bessel/timeline';

/** A bad figure-of-merit input (loud, located). */
export class FigureOfMeritError extends Error {
  constructor(message: string) {
    super(`coverage figure of merit: ${message}`);
    this.name = 'FigureOfMeritError';
  }
}

/** The additive richer-statistics fields layered onto FigureOfMerit. */
export interface FigureOfMeritStats {
  /** Mean per-interval access duration (s); 0 when there are no accesses. */
  readonly meanAccessDurationSec: number;
  /** Longest single access duration (s); 0 when there are no accesses. */
  readonly maxAccessDurationSec: number;
  /**
   * Longest revisit gap (s): the longest gap strictly BETWEEN two consecutive
   * accesses, excluding the lead-in before the first access and the trail-out after
   * the last. 0 when there are fewer than two accesses (no interior gap exists).
   */
  readonly revisitMaxSec: number;
  /** Mean interior (between-access) revisit gap (s); 0 when fewer than two accesses. */
  readonly revisitMeanSec: number;
  /**
   * Mean response time (s): the expected wait until the next access for a uniformly
   * random arrival over the span. Computed as the time-weighted mean of the
   * remaining-time-to-next-access. Over a no-access stretch ending at the start of
   * the next access, the remaining time falls linearly from the stretch length L to
   * 0, contributing L^2 / 2 to the integral; dividing the summed integral by the
   * span gives sum(L_i^2) / (2 * span). The trail-out after the last access has no
   * "next access" and contributes nothing (those arrivals are never served within
   * the span). Equivalently, for the interior + lead-in gaps it is
   * sum(gap_i^2) / (2 * span). null when the point is never accessed.
   */
  readonly responseTimeSec: number | null;
}

/**
 * Compute the additive richer FOM statistics from an access window over [t0, t1].
 * `window` must be a normalized Window (sorted, disjoint, non-abutting); the span
 * must be increasing. Throws FigureOfMeritError on a non-increasing span.
 */
export function figureOfMeritStats(
  window: Window,
  span: readonly [EphemerisTime, EphemerisTime],
): FigureOfMeritStats {
  const [t0, t1] = span;
  if (!(t1 > t0)) {
    throw new FigureOfMeritError(`span must be increasing, got [${t0}, ${t1}]`);
  }
  const duration = t1 - t0;

  // Per-access durations.
  const durations = window.map(([s, e]) => e - s);
  const meanAccessDurationSec = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
  const maxAccessDurationSec = durations.length ? Math.max(...durations) : 0;

  // Interior revisit gaps: between the stop of access k and the start of access k+1.
  const revisitGaps: number[] = [];
  for (let k = 0; k + 1 < window.length; k++) {
    const gap = window[k + 1]![0] - window[k]![1];
    if (gap > 0) revisitGaps.push(gap);
  }
  const revisitMaxSec = revisitGaps.length ? Math.max(...revisitGaps) : 0;
  const revisitMeanSec = revisitGaps.length
    ? revisitGaps.reduce((a, b) => a + b, 0) / revisitGaps.length
    : 0;

  // Mean response time: sum over no-access stretches that END at a future access of
  // L^2 / (2 * span). These are the lead-in (before the first access, if any) and
  // every interior gap. The trail-out after the last access is excluded.
  let responseTimeSec: number | null;
  if (window.length === 0) {
    responseTimeSec = null;
  } else {
    const leadIn = Math.max(0, window[0]![0] - t0);
    let integral = leadIn * leadIn;
    for (const gap of revisitGaps) integral += gap * gap;
    responseTimeSec = integral / (2 * duration);
  }

  return { meanAccessDurationSec, maxAccessDurationSec, revisitMaxSec, revisitMeanSec, responseTimeSec };
}
