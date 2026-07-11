// [ux-p3-conjunction] The maneuver-then-rescreen helpers are pure, so the maneuvered-ephemeris
// builder, the catalog re-screen, the pair finder, and the before/after Pc comparison are tested
// directly. A hand-built two-object catalog with a near miss lets us assert that an along-track burn
// opens the miss and the comparison reads "reduced".

import { describe, it, expect } from 'vitest';
import { screenAllVsAll, type SampledEphemeris } from '@bessel/conjunction';
import {
  buildManeuveredEphemeris,
  screenManeuveredPrimary,
  findPairEvent,
  comparePcBeforeAfter,
} from './rescreen.ts';

/** Build a sampled ephemeris from explicit per-sample [x,y,z] positions, with a constant velocity
 *  derived from the first step so the along-track direction is well defined. Tagged with radius +
 *  sigma so the screen produces a 2D Pc. */
function ephemeris(id: string, et: number[], positions: readonly (readonly [number, number, number])[]): SampledEphemeris {
  const n = et.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = positions[i]![0];
    pos[i * 3 + 1] = positions[i]![1];
    pos[i * 3 + 2] = positions[i]![2];
  }
  for (let i = 0; i < n; i++) {
    const j = i < n - 1 ? i : i - 1;
    const dt = et[j + 1]! - et[j]!;
    for (let c = 0; c < 3; c++) vel[i * 3 + c] = (pos[(j + 1) * 3 + c]! - pos[j * 3 + c]!) / dt;
  }
  return { id, et: Float64Array.from(et), pos, vel, radiusKm: 0.05, sigmaKm: 0.5 };
}

// A primary moving along +X through the origin at the middle sample; a secondary crossing the same
// point along +Y at the same instant (t = 50), so they nearly collide there. An along-track shift of
// the primary changes WHERE it is when the secondary crosses, opening a real miss (the realistic
// avoidance geometry, unlike a co-linear shift that only changes the encounter timing).
const ET = [0, 25, 50, 75, 100];
const primary = ephemeris('PRIMARY', ET, [
  [-100, 0, 0],
  [-50, 0, 0],
  [0, 0, 0],
  [50, 0, 0],
  [100, 0, 0],
]);
const secondary = ephemeris('SECONDARY', ET, [
  [0, -100, 0],
  [0, -50, 0],
  [0, 0.2, 0],
  [0, 50, 0],
  [0, 100, 0],
]);
const catalog = [primary, secondary];

describe('buildManeuveredEphemeris', () => {
  it('drifts the primary along-track from the burn sample, leaving pre-burn samples untouched', () => {
    // Burn at t=25 (sample index 1) with a +X (along-track) impulse.
    const man = buildManeuveredEphemeris(primary, { dvKmS: 1, burnEt: 25 });
    // Sample 0 (pre-burn) is unchanged.
    expect(man.pos[0]).toBe(primary.pos[0]);
    // Sample 4 (t=100) drifts by dv * (100 - 25) = 75 km along +X.
    expect(man.pos[4 * 3]).toBeCloseTo(primary.pos[4 * 3]! + 75, 6);
    // The original ephemeris is not mutated.
    expect(primary.pos[4 * 3]).toBe(100);
  });

  it('fails loud on a non-finite delta-v or a degenerate burn-sample velocity', () => {
    expect(() => buildManeuveredEphemeris(primary, { dvKmS: Number.NaN, burnEt: 0 })).toThrow(/delta-v must be finite/);
    const still = ephemeris('STILL', ET, ET.map(() => [1, 1, 1] as const));
    expect(() => buildManeuveredEphemeris(still, { dvKmS: 1, burnEt: 0 })).toThrow(/degenerate velocity/);
  });
});

describe('screenManeuveredPrimary + comparePcBeforeAfter', () => {
  it('opens the miss and reports the risk reduced after the burn', () => {
    const before = screenAllVsAll(catalog, { thresholdKm: 10 }).find(
      (e) => e.primaryId === 'PRIMARY' || e.secondaryId === 'PRIMARY',
    )!;
    expect(before.missKm).toBeLessThan(1);

    // A large along-track burn at the catalog epoch sweeps the primary far past the secondary by the
    // encounter, so the rescreened miss grows (or the pair drops out entirely).
    const maneuvered = buildManeuveredEphemeris(primary, { dvKmS: 5, burnEt: 0 });
    const rescreened = screenManeuveredPrimary(catalog, maneuvered, 200, 200);
    const after = findPairEvent(rescreened, 'PRIMARY', 'SECONDARY');

    const cmp = comparePcBeforeAfter(before, after);
    expect(cmp.primaryId).toBe('PRIMARY');
    expect(cmp.beforeMissKm).toBe(before.missKm);
    expect(cmp.reduced).toBe(true);
    // The after miss (if the pair survived the rescreen) is larger than the before miss.
    if (cmp.afterMissKm !== null) expect(cmp.afterMissKm).toBeGreaterThan(cmp.beforeMissKm);
  });

  it('comparePcBeforeAfter prefers the Pc comparison when both Pc values exist', () => {
    const beforeEv = { primaryId: 'A', secondaryId: 'B', tca: 0, missKm: 0.3, relSpeedKmS: 7, pc: 1e-4 };
    const afterEv = { primaryId: 'A', secondaryId: 'B', tca: 0, missKm: 5, relSpeedKmS: 7, pc: 1e-7 };
    expect(comparePcBeforeAfter(beforeEv, afterEv).reduced).toBe(true);
    expect(comparePcBeforeAfter(afterEv, beforeEv).reduced).toBe(false);
  });

  it('treats a dropped-out pair (no after event) as an unambiguous reduction', () => {
    const beforeEv = { primaryId: 'A', secondaryId: 'B', tca: 0, missKm: 0.3, relSpeedKmS: 7, pc: 1e-4 };
    const cmp = comparePcBeforeAfter(beforeEv, null);
    expect(cmp.afterMissKm).toBeNull();
    expect(cmp.reduced).toBe(true);
  });
});
