// Mission time window helpers. The catalog coverage hints often coincide exactly
// with SPK boundaries, so we inset by a margin to guarantee interpolation always
// has data at the sampled epochs.

/** Typed, located error for a window that cannot yield a usable (positive) span. */
export class MissionWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionWindowError';
  }
}

export function missionWindow(
  rawEt0: number,
  rawEt1: number,
  marginSec: number,
): readonly [number, number] {
  // The margin insets BOTH ends, so it consumes 2 * margin of span. An arc shorter
  // than that would invert (et0 > et1) or collapse (et0 === et1) the window, and the
  // sampler would then divide by a zero (or negative) span and feed NaN into the
  // float32 GPU buffers, the FOV, and telemetry. A non-positive raw span has no
  // interior to sample at all, so fail loudly; otherwise clamp the margin to strictly
  // under half the span so the inset window keeps a positive width.
  const span = rawEt1 - rawEt0;
  if (!Number.isFinite(span) || span <= 0) {
    throw new MissionWindowError(
      `Mission arc has no positive span: raw window [${rawEt0}, ${rawEt1}] (span ${span}s). ` +
        'Widen the arc timeRange.',
    );
  }
  // Strictly less than span/2 on each side, so et0 < et1 always holds.
  const margin = Math.min(marginSec, span * 0.49);
  return [rawEt0 + margin, rawEt1 - margin];
}
