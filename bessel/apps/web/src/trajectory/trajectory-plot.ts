// Catalog trajectoryPlot styling (item 5 / backlog C16): when a body or spacecraft
// declares a trajectoryPlot, the rendered polyline honors its declared color/fade
// (instead of the synthesized blue trail ramp) and is bounded by lead/trail/duration
// around the cursor epoch with sampleCount controlling the sample density. These are
// pure helpers; the generic-mission orchestrator calls them and does the SPICE work.

import type { CssColor, TrajectoryPlot } from '@bessel/catalog';

/** A 0..1 RGB tuple, the form the scene's per-vertex trajectory colors use. */
export type Rgb01 = readonly [number, number, number];

/** The sampling window and density a trajectoryPlot implies around a cursor epoch. */
export interface PlotWindow {
  /** Sampling start (ET seconds), clamped into the mission window. */
  readonly et0: number;
  /** Sampling stop (ET seconds), clamped into the mission window. */
  readonly et1: number;
  /** Number of samples along the polyline. */
  readonly steps: number;
}

/**
 * Parse a trajectoryPlot duration field: a number is seconds; a string is an
 * ISO-8601-style duration. Supports the Cosmographia-common forms: a bare number
 * (seconds), "<n> d"/"<n> h" (Cosmographia spacing), and ISO "P[n]DT[n]H[n]M[n]S".
 * Returns seconds, or null when absent or unparseable (caller falls back).
 */
export function durationSeconds(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Cosmographia "<n> <unit>" (e.g. "10 d", "6 h", "1800 s").
  const simple = /^([0-9]*\.?[0-9]+)\s*([dhms])$/i.exec(trimmed);
  if (simple) {
    const n = Number.parseFloat(simple[1]!);
    const unit = simple[2]!.toLowerCase();
    const scale = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return Number.isFinite(n) && n >= 0 ? n * scale : null;
  }
  // A bare number string is seconds.
  const bare = Number.parseFloat(trimmed);
  if (/^[0-9]*\.?[0-9]+$/.test(trimmed) && Number.isFinite(bare)) return bare >= 0 ? bare : null;
  // ISO-8601 duration: P[nD]T[nH][nM][nS].
  const iso = /^P(?:([0-9]*\.?[0-9]+)D)?(?:T(?:([0-9]*\.?[0-9]+)H)?(?:([0-9]*\.?[0-9]+)M)?(?:([0-9]*\.?[0-9]+)S)?)?$/i.exec(
    trimmed,
  );
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    const d = Number.parseFloat(iso[1] ?? '0');
    const h = Number.parseFloat(iso[2] ?? '0');
    const m = Number.parseFloat(iso[3] ?? '0');
    const s = Number.parseFloat(iso[4] ?? '0');
    const total = d * 86400 + h * 3600 + m * 60 + s;
    return Number.isFinite(total) && total >= 0 ? total : null;
  }
  return null;
}

/**
 * The sampling window a trajectoryPlot implies, bounding the drawn polyline to
 * [cursor - trail, cursor + lead] (or +/- duration/2 when only duration is given),
 * clamped to the mission window [missionEt0, missionEt1]. With no lead/trail/duration
 * the full mission window is used. sampleCount sets the density (clamped to a sane
 * floor/ceiling); without it the default `steps` is kept.
 */
export function plotWindow(
  plot: TrajectoryPlot | undefined,
  cursorEt: number,
  missionEt0: number,
  missionEt1: number,
  defaultSteps: number,
): PlotWindow {
  if (!plot) return { et0: missionEt0, et1: missionEt1, steps: defaultSteps };
  const lead = durationSeconds(plot.lead);
  const trail = durationSeconds(plot.trail);
  const duration = durationSeconds(plot.duration);

  let et0 = missionEt0;
  let et1 = missionEt1;
  if (lead !== null || trail !== null) {
    et0 = cursorEt - (trail ?? 0);
    et1 = cursorEt + (lead ?? 0);
  } else if (duration !== null && duration > 0) {
    // A duration alone centers the window on the cursor.
    et0 = cursorEt - duration / 2;
    et1 = cursorEt + duration / 2;
  }
  // Clamp into the mission window so sampling never leaves the loaded ephemeris.
  et0 = Math.max(missionEt0, Math.min(et0, missionEt1));
  et1 = Math.max(missionEt0, Math.min(et1, missionEt1));
  if (et1 <= et0) {
    // A degenerate bound (e.g. cursor at an edge with zero lead): fall back to full.
    et0 = missionEt0;
    et1 = missionEt1;
  }
  const steps =
    plot.sampleCount && Number.isFinite(plot.sampleCount)
      ? Math.max(2, Math.min(4096, Math.floor(plot.sampleCount)))
      : defaultSteps;
  return { et0, et1, steps };
}

/** Convert a CssColor (string hex or {r,g,b}) to a 0..1 RGB tuple, or null. */
export function cssColorToRgb01(c: CssColor | undefined): Rgb01 | null {
  if (c === undefined) return null;
  if (typeof c === 'object') return [c.r, c.g, c.b];
  const hex = c.trim().replace(/^#/, '');
  if (hex.length !== 6) return null;
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return null;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Per-vertex colors for a trajectoryPlot's declared color. `fade` (0..1) dims the
 * trail's oldest (first) vertex toward black, ramping up to full color at the
 * newest (last) vertex, mirroring the Cosmographia trail fade. fade 0 (or absent)
 * is a flat solid color. Returns one Rgb01 per point.
 */
export function plotColors(color: Rgb01, fade: number | undefined, count: number): Rgb01[] {
  const f = fade === undefined ? 0 : Math.max(0, Math.min(1, fade));
  const last = Math.max(1, count - 1);
  const out: Rgb01[] = [];
  for (let i = 0; i < count; i++) {
    // t in [0,1] from oldest to newest; brightness ramps from (1 - fade) to 1.
    const t = i / last;
    const b = 1 - f * (1 - t);
    out.push([color[0] * b, color[1] * b, color[2] * b]);
  }
  return out;
}
