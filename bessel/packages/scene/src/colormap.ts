// A small, pure viridis-like sequential colormap, separated from the scene so it can
// be unit tested headlessly. Maps a scalar in [0, 1] to a linear RGB triple in [0, 1].
// The control points are a coarse sampling of matplotlib's viridis (perceptually
// uniform, colorblind-friendly), interpolated linearly between stops; out-of-range
// inputs clamp to the endpoints. Kept dependency-free so @bessel/scene stays SPICE-free
// and self-contained.

import type { Rgb01 } from './scene-spec.ts';

// Viridis control points at t = 0, 0.25, 0.5, 0.75, 1, treated as linear scene colors.
// A coarse table is enough for an overlay ramp and keeps the function allocation-light.
const VIRIDIS_STOPS: readonly Rgb01[] = [
  [0.267, 0.005, 0.329], // dark violet
  [0.229, 0.322, 0.545], // blue
  [0.127, 0.567, 0.551], // teal
  [0.369, 0.789, 0.383], // green
  [0.993, 0.906, 0.144], // yellow
];

/**
 * Map a scalar to a viridis-like linear RGB color. The input is clamped to [0, 1]
 * (a non-finite input clamps to 0), then linearly interpolated between the nearest
 * control points, so 0 yields the dark-violet low end and 1 the yellow high end (two
 * clearly distinct colors).
 */
export function viridis(value: number): Rgb01 {
  const t = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const last = VIRIDIS_STOPS.length - 1;
  const scaled = t * last;
  const lo = Math.min(last, Math.floor(scaled));
  const hi = Math.min(last, lo + 1);
  const frac = scaled - lo;
  const a = VIRIDIS_STOPS[lo]!;
  const b = VIRIDIS_STOPS[hi]!;
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
}
