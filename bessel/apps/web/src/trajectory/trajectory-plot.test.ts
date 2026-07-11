// Pure trajectoryPlot helpers (C16): duration parsing, the cursor-bounded sampling
// window, and the declared-color trail (with fade). No SPICE; pure data in, pure
// data out, so the orchestrator's honoring of trajectoryPlot is checked at the seam.

import { describe, it, expect } from 'vitest';
import { durationSeconds, plotWindow, plotColors, cssColorToRgb01 } from './trajectory-plot.ts';

describe('durationSeconds', () => {
  it('reads a number as seconds and rejects negatives', () => {
    expect(durationSeconds(1800)).toBe(1800);
    expect(durationSeconds(-5)).toBeNull();
  });

  it('parses Cosmographia "<n> <unit>" forms', () => {
    expect(durationSeconds('10 d')).toBe(10 * 86400);
    expect(durationSeconds('6 h')).toBe(6 * 3600);
    expect(durationSeconds('30 m')).toBe(30 * 60);
    expect(durationSeconds('45 s')).toBe(45);
  });

  it('parses ISO-8601 durations', () => {
    expect(durationSeconds('PT1H30M')).toBe(5400);
    expect(durationSeconds('P2D')).toBe(2 * 86400);
  });

  it('returns null for absent or unparseable input', () => {
    expect(durationSeconds(undefined)).toBeNull();
    expect(durationSeconds('soon')).toBeNull();
  });
});

describe('plotWindow', () => {
  it('uses the full mission window with no plot', () => {
    expect(plotWindow(undefined, 50, 0, 100, 64)).toEqual({ et0: 0, et1: 100, steps: 64 });
  });

  it('bounds [cursor - trail, cursor + lead] clamped into the mission window', () => {
    const w = plotWindow({ trail: 20, lead: 10 }, 50, 0, 100, 64);
    expect(w.et0).toBe(30);
    expect(w.et1).toBe(60);
  });

  it('clamps a lead/trail that overruns the mission window', () => {
    const w = plotWindow({ trail: 1000, lead: 1000 }, 50, 0, 100, 64);
    expect(w.et0).toBe(0);
    expect(w.et1).toBe(100);
  });

  it('centers a duration-only window on the cursor', () => {
    const w = plotWindow({ duration: 40 }, 50, 0, 100, 64);
    expect(w.et0).toBe(30);
    expect(w.et1).toBe(70);
  });

  it('uses sampleCount for the density, clamped to a sane range', () => {
    expect(plotWindow({ sampleCount: 12 }, 50, 0, 100, 64).steps).toBe(12);
    expect(plotWindow({ sampleCount: 1 }, 50, 0, 100, 64).steps).toBe(2);
  });
});

describe('plotColors', () => {
  it('is a flat solid color without fade', () => {
    const c = plotColors([1, 0, 0], undefined, 3);
    for (const v of c) expect(v).toEqual([1, 0, 0]);
  });

  it('darkens the oldest vertex to black and brightens to full at the newest with fade 1', () => {
    const c = plotColors([1, 0.5, 0], 1, 3);
    expect(c[0]).toEqual([0, 0, 0]);
    expect(c[2]).toEqual([1, 0.5, 0]);
  });
});

describe('cssColorToRgb01', () => {
  it('parses a hex string and an object color', () => {
    expect(cssColorToRgb01('#ff0000')).toEqual([1, 0, 0]);
    expect(cssColorToRgb01({ r: 0, g: 1, b: 0 })).toEqual([0, 1, 0]);
  });

  it('returns null for an unparseable or absent color', () => {
    expect(cssColorToRgb01(undefined)).toBeNull();
    expect(cssColorToRgb01('red')).toBeNull();
  });
});
