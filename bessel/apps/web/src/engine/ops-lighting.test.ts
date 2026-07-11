import { describe, it, expect } from 'vitest';
import { createAppStore } from '../store/index.ts';
import {
  computeBetaSeries,
  computeEclipsePhases,
  computeSolarIntensity,
  eclipseOnsetDeg,
  windowTotalSec,
} from './ops-lighting.ts';
import type { EngineCore } from './bootstrap.ts';

// The lighting ops own the Phase-1 lighting slices. These tests cover the pure threshold
// + window-total helpers directly, then drive the three ops through a minimal fake engine
// core (only the methods the @bessel/events paths call are stubbed) to assert each writes
// the expected slice shape; the geometry itself is the @bessel/events suite's concern.

describe('eclipseOnsetDeg (eclipse-season threshold)', () => {
  it('is asin(bodyRadius / orbitRadius) in degrees for an orbit above the body', () => {
    // A 6378 km body at a 6378 * 2 km orbit radius: asin(0.5) = 30 deg.
    expect(eclipseOnsetDeg(6378, 12756)).toBeCloseTo(30, 6);
  });
  it('saturates at 90 deg when the orbit is at or below the body radius (degenerate)', () => {
    expect(eclipseOnsetDeg(6378, 6378)).toBe(90);
    expect(eclipseOnsetDeg(6378, 100)).toBe(90);
  });
});

describe('windowTotalSec', () => {
  it('sums the durations of disjoint windows', () => {
    expect(windowTotalSec([])).toBe(0);
    expect(
      windowTotalSec([
        [0, 100],
        [250, 300],
      ]),
    ).toBe(150);
  });
});

/** A minimal EngineCore whose spice stub answers only the calls the lighting ops make:
 *  a circular Earth-like orbit (so beta/intensity have a real geometry) and a gfoclt that
 *  returns a fixed umbra window. Cast through unknown because EngineCore is a wide type and
 *  the ops only ever touch identity, clock.state.et, and these spice methods. */
function fakeCore(): EngineCore {
  const re = 6378.137;
  const orbit = re + 700; // 700 km LEO radius
  const spice = {
    // Sun far along +x; satellite in the x-y plane on a circular orbit (here pinned).
    async spkpos(target: string) {
      if (target === 'SUN') return { position: { x: 1.5e8, y: 0, z: 0 } };
      return { position: { x: orbit, y: 0, z: 0 } };
    },
    async spkezr() {
      // r along +x, v along +y: orbit normal along +z, |r x v| > 0 (non-degenerate).
      return { position: { x: orbit, y: 0, z: 0 }, velocity: { x: 0, y: 7.5, z: 0 } };
    },
    async bodvrd(body: string) {
      return body === 'SUN' ? [695700, 695700, 695700] : [re, re, re];
    },
    async gfoclt(occtyp: string): Promise<[number, number][]> {
      return occtyp === 'FULL' ? [[100, 200]] : [];
    },
  };
  return {
    identity: { spacecraftName: 'SAT', centerBody: 'EARTH' },
    clock: { state: { et: 0 } },
    spice,
  } as unknown as EngineCore;
}

const live = (): (() => boolean) => () => false;

describe('the lighting ops write their expected slice shapes', () => {
  it('computeEclipsePhases stores all four phases and a per-day shadowed duration', async () => {
    const store = createAppStore();
    await computeEclipsePhases(fakeCore(), store, live(), { spanSec: 86400 });
    const p = store.getState().eclipsePhases;
    expect(p).not.toBeNull();
    expect(p?.umbra).toEqual([[100, 200]]);
    expect(p?.penumbra).toEqual([]);
    expect(p?.annular).toEqual([]);
    // sunlit is the complement of the union over the span, so it covers most of the day.
    expect(windowTotalSec(p?.sunlit ?? [])).toBeGreaterThan(86000);
    expect(p?.shadowSecPerDay).toBeCloseTo(100, 6); // 100 s umbra over a 1-day span
  });

  it('computeBetaSeries stores a deg series and the eclipse-onset threshold', async () => {
    const store = createAppStore();
    await computeBetaSeries(fakeCore(), store, live(), { spanSec: 3600, stepSec: 1800 });
    const b = store.getState().betaSeries;
    expect(b).not.toBeNull();
    expect(b?.series.value.length).toBeGreaterThan(0);
    // Sun on +x, orbit normal on +z: beta = 0 deg for this pinned geometry.
    expect(b?.series.value[0]).toBeCloseTo(0, 6);
    // onset = asin(re / orbitRadius) for a ~700 km LEO, a small positive angle.
    expect(b?.onsetDeg).toBeGreaterThan(0);
    expect(b?.onsetDeg).toBeLessThan(90);
  });

  it('computeSolarIntensity stores a 0..1 visible-fraction series', async () => {
    const store = createAppStore();
    await computeSolarIntensity(fakeCore(), store, live(), { spanSec: 120, stepSec: 60 });
    const s = store.getState().solarIntensitySeries;
    expect(s).not.toBeNull();
    // Sun and body on opposite-ish lines of sight here: full sun (fraction 1).
    for (const v of s?.value ?? []) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clears the slices and stays quiet when no spacecraft is loaded', async () => {
    const store = createAppStore();
    const empty = { identity: { spacecraftName: null, centerBody: null }, clock: { state: { et: 0 } } } as unknown as EngineCore;
    await computeEclipsePhases(empty, store, live());
    await computeBetaSeries(empty, store, live());
    await computeSolarIntensity(empty, store, live());
    expect(store.getState().eclipsePhases).toBeNull();
    expect(store.getState().betaSeries).toBeNull();
    expect(store.getState().solarIntensitySeries).toBeNull();
  });
});
