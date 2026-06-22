// All-vs-all screening oracle: a constructed scenario with one known crossing pair
// (two objects whose paths intersect at a known epoch) and decoys placed far away.
// The screen must flag exactly the crossing pair, at the right TCA, with the right
// miss, and must reject the decoys via the apogee/perigee + box sieve.
// (STK_PARITY_SPEC §4.8, CAT-SCR-1/CAT-TCA-1.)

import { describe, it, expect } from 'vitest';
import { screenAllVsAll, ScreenError, type SampledEphemeris } from './index.ts';

/** Build a rectilinear ephemeris from an initial state and constant velocity. */
function rectilinear(
  id: string,
  p0: [number, number, number],
  v: [number, number, number],
  et: Float64Array,
  extra: Partial<SampledEphemeris> = {},
): SampledEphemeris {
  const n = et.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  const t0 = et[0]!;
  for (let k = 0; k < n; k++) {
    const dt = et[k]! - t0;
    pos[k * 3] = p0[0] + v[0] * dt;
    pos[k * 3 + 1] = p0[1] + v[1] * dt;
    pos[k * 3 + 2] = p0[2] + v[2] * dt;
    vel[k * 3] = v[0];
    vel[k * 3 + 1] = v[1];
    vel[k * 3 + 2] = v[2];
  }
  return { id, et, pos, vel, ...extra };
}

const grid = (start: number, n: number, step: number): Float64Array =>
  Float64Array.from({ length: n }, (_, k) => start + k * step);

describe('screenAllVsAll', () => {
  it('flags exactly the crossing pair at the right TCA and rejects far decoys', () => {
    // 600 s span, 10 s steps. Two ~7000 km-radius objects cross near t = 300 s with a
    // 2 km miss; two decoys sit in a much higher shell and never come close.
    const et = grid(0, 61, 10);
    const R = 7000;
    // Primary: moving in +x through (R,0,0) at +7 km/s in y, reaching x=R at t=300.
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], et, { radiusKm: 0.005, sigmaKm: 0.1 });
    // Secondary: crosses the same point from +y, offset 2 km in z (the miss distance).
    const b = rectilinear('B', [R, -7 * 300, 2], [0, 7, 0], et, { radiusKm: 0.005, sigmaKm: 0.1 });
    // Decoys: a high shell (~42000 km), well outside the apogee/perigee band of A/B.
    const c = rectilinear('C', [42000, 0, 0], [0, 3, 0], et);
    const d = rectilinear('D', [42000, -3 * 600, 0], [0, 3, 0], et);

    const events = screenAllVsAll([a, b, c, d], { thresholdKm: 5 });

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(new Set([ev.primaryId, ev.secondaryId])).toEqual(new Set(['A', 'B']));
    expect(ev.tca).toBeCloseTo(300, 0);
    expect(ev.missKm).toBeCloseTo(2, 1);
    expect(ev.relSpeedKmS).toBeCloseTo(Math.hypot(7, 7), 6);
    expect(ev.pc).not.toBeNull();
    expect(ev.pc!).toBeGreaterThan(0);
  });

  it('rejects the pair when the miss exceeds the threshold', () => {
    const et = grid(0, 61, 10);
    const R = 7000;
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], et);
    // 12 km miss in z, above the 5 km threshold.
    const b = rectilinear('B', [R, -7 * 300, 12], [0, 7, 0], et);
    expect(screenAllVsAll([a, b], { thresholdKm: 5 })).toHaveLength(0);
  });

  it('reports null Pc when covariance is absent and is symmetric in pair order', () => {
    const et = grid(0, 61, 10);
    const R = 7000;
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], et);
    const b = rectilinear('B', [R, -7 * 300, 1], [0, 7, 0], et);
    const ev = screenAllVsAll([a, b], { thresholdKm: 5 })[0]!;
    expect(ev.pc).toBeNull();
    expect(ev.missKm).toBeCloseTo(1, 2);
  });

  it('rejects a mismatched screening grid (different length)', () => {
    const R = 7000;
    const etA = grid(0, 61, 10);
    const etB = grid(0, 41, 10); // shorter grid: b would be indexed out of its own range
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], etA);
    const b = rectilinear('B', [R, -7 * 300, 2], [0, 7, 0], etB);
    expect(() => screenAllVsAll([a, b], { thresholdKm: 5 })).toThrow(ScreenError);
    expect(() => screenAllVsAll([a, b], { thresholdKm: 5 })).toThrow(/share one screening grid/);
  });

  it('rejects a mismatched screening grid (same length, different epochs)', () => {
    const R = 7000;
    const etA = grid(0, 61, 10); // 0..600
    const etB = grid(5, 61, 10); // 5..605: same length, shifted half a step
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], etA);
    const b = rectilinear('B', [R, -7 * 300, 2], [0, 7, 0], etB);
    expect(() => screenAllVsAll([a, b], { thresholdKm: 5 })).toThrow(/share one screening grid/);
  });

  it('places the TCA and miss between samples for a closest approach off the grid', () => {
    // Coarse 20 s grid. The relative motion is built directly so the true closest approach is at
    // t = 130 s (between the samples at 120 and 140), with a 0.5 km miss, while the discrete grid
    // minimum sits at a sample with a much larger separation. The relative velocity also changes
    // sample to sample (curved, non-rectilinear motion), so a refiner that anchors on a bracket
    // edge with that edge's stale velocity mis-locates the TCA; refining about the bracketed
    // minimum sample recovers it.
    const et = grid(0, 21, 20); // 0..400, samples every 20 s
    const n = et.length;
    const posA = new Float64Array(n * 3);
    const velA = new Float64Array(n * 3);
    const posB = new Float64Array(n * 3);
    const velB = new Float64Array(n * 3);
    const R = 7000;
    // Object A: straight line through (R,0,0) along +y at 5 km/s.
    // Object B: tracks A in y but approaches in x as a steep parabola minimized (0.5 km) at
    // t = 130 s, so the separation is 0.5 km at t=130 but ~5.5 km at the bracketing 120/140 s
    // samples. B's per-sample velocity changes each step (the dx slope and a curving y), so a
    // refiner anchored on a bracket edge with that edge's stale velocity mis-locates the TCA.
    for (let k = 0; k < n; k++) {
      const t = et[k]!;
      posA[k * 3] = R;
      posA[k * 3 + 1] = 5 * (t - 130);
      posA[k * 3 + 2] = 0;
      velA[k * 3] = 0;
      velA[k * 3 + 1] = 5;
      velA[k * 3 + 2] = 0;
      const dtm = t - 130;
      posB[k * 3] = R + 0.5 + 0.05 * dtm * dtm; // dx: 0.5 at t=130, 5.5 at t=120/140
      posB[k * 3 + 1] = 5 * dtm + 0.001 * dtm * dtm;
      posB[k * 3 + 2] = 0;
      velB[k * 3] = 0.1 * dtm; // changing x-velocity sample to sample
      velB[k * 3 + 1] = 5 + 0.002 * dtm;
      velB[k * 3 + 2] = 0;
    }
    const a: SampledEphemeris = { id: 'A', et, pos: posA, vel: velA, radiusKm: 0.005, sigmaKm: 0.1 };
    const b: SampledEphemeris = { id: 'B', et, pos: posB, vel: velB, radiusKm: 0.005, sigmaKm: 0.1 };
    const events = screenAllVsAll([a, b], { thresholdKm: 5 });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    // TCA recovered between the 120 s and 140 s samples (not snapped to either), miss ~0.5 km.
    expect(ev.tca).toBeGreaterThan(120);
    expect(ev.tca).toBeLessThan(140);
    expect(ev.tca).toBeCloseTo(130, 0);
    expect(ev.missKm).toBeLessThan(2.0); // true 0.5 km, far below the ~5.5 km discrete-grid minimum
  });

  it('invokes onProgress once per primary with a monotonic done and the fixed total', () => {
    const et = grid(0, 61, 10);
    const R = 7000;
    const a = rectilinear('A', [R - 7 * 300, 0, 0], [7, 0, 0], et);
    const b = rectilinear('B', [R, -7 * 300, 2], [0, 7, 0], et);
    const c = rectilinear('C', [42000, 0, 0], [0, 3, 0], et);
    const d = rectilinear('D', [42000, -3 * 600, 0], [0, 3, 0], et);
    const objects = [a, b, c, d];

    const ticks: { done: number; total: number }[] = [];
    screenAllVsAll(objects, { thresholdKm: 5, onProgress: (done, total) => ticks.push({ done, total }) });

    const total = objects.length - 1; // the last object has no higher-index partner
    expect(ticks).toHaveLength(total);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]!.done).toBe(i + 1); // strictly monotonic 1..total
      expect(ticks[i]!.total).toBe(total); // constant across the run
    }
  });

  it('fails loudly on malformed input', () => {
    const et = grid(0, 3, 10);
    const bad: SampledEphemeris = { id: 'X', et, pos: new Float64Array(6), vel: new Float64Array(9) };
    expect(() => screenAllVsAll([bad], { thresholdKm: 5 })).toThrow(ScreenError);
    const ok = rectilinear('Y', [0, 0, 0], [1, 0, 0], et);
    expect(() => screenAllVsAll([ok], { thresholdKm: 0 })).toThrow(ScreenError);
  });
});
