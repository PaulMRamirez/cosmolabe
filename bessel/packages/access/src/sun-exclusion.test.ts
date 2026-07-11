// Oracle test for the Sun-exclusion (sensor keep-out) constraint on the Cassini fixtures.
// The gfsep-produced window is cross-checked against an independent angular separation computed
// from two spkpos directions (vsep): at every interior interval midpoint the observer-to-Sun /
// observer-to-target separation is at or above the keep-out (so the access is real), and at every
// interior edge the separation equals the keep-out (so the boundary is exact). A second case
// shows the window composes through the existing intersection (a tighter keep-out is a subset).
// (STK_PARITY_SPEC §4.3, ACC sun-exclusion.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine, type Vec3 } from '@bessel/spice';
import { windowMeasure, windowContains } from '@bessel/timeline';
import { computeAccess, SunExclusionConstraintError } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
const TARGET = 'SATURN';

// Independent angular separation (rad) between the observer-to-Sun and observer-to-target
// directions, the same quantity gfsep reports for two POINT shapes.
const vsep = (a: Vec3, b: Vec3): number => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const ma = Math.hypot(a.x, a.y, a.z);
  const mb = Math.hypot(b.x, b.y, b.z);
  return Math.acos(Math.max(-1, Math.min(1, dot / (ma * mb))));
};

describe('@bessel/access sunExclusion constraint', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;

  const separationAt = async (et: number): Promise<number> => {
    const sun = await spice.spkpos('SUN', et, 'J2000', 'NONE', CASSINI);
    const tgt = await spice.spkpos(TARGET, et, 'J2000', 'NONE', CASSINI);
    return vsep(sun.position, tgt.position);
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
  });

  it('window matches an independent vsep keep-out: midpoints above, edges at the floor', async () => {
    // A keep-out the Sun-to-Saturn separation actually crosses over the window, so there are
    // interior edges to validate.
    const samples = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((h) => separationAt(t0 + h * 3600)));
    const keepoutRad = (Math.min(...samples) + Math.max(...samples)) / 2;

    const access = await computeAccess(spice, {
      observer: CASSINI,
      target: TARGET,
      span: [t0, t1],
      step: 120,
      constraints: [{ kind: 'sunExclusion', keepoutRad }],
    });
    expect(access.length).toBeGreaterThan(0);

    for (const [s, e] of access) {
      // Inside an admitted interval the separation clears the keep-out (independent vsep).
      expect(await separationAt((s + e) / 2)).toBeGreaterThanOrEqual(keepoutRad - 1e-6);
      expect(windowContains(access, (s + e) / 2)).toBe(true);
      // Each interior edge sits exactly at the keep-out angle.
      for (const b of [s, e]) {
        if (b === t0 || b === t1) continue;
        expect(await separationAt(b)).toBeCloseTo(keepoutRad, 6);
      }
    }
  });

  it('a tighter keep-out is a subset of a looser one (composes through intersection)', async () => {
    const samples = await Promise.all([0, 2, 4, 6].map((h) => separationAt(t0 + h * 3600)));
    const loose = Math.min(...samples) - 0.01; // admits effectively everything reachable
    const tight = (Math.min(...samples) + Math.max(...samples)) / 2; // trims the window

    const looseW = await computeAccess(spice, {
      observer: CASSINI, target: TARGET, span: [t0, t1], step: 120,
      constraints: [{ kind: 'sunExclusion', keepoutRad: loose }],
    });
    const tightW = await computeAccess(spice, {
      observer: CASSINI, target: TARGET, span: [t0, t1], step: 120,
      constraints: [{ kind: 'sunExclusion', keepoutRad: tight }],
    });
    expect(windowMeasure(tightW)).toBeLessThanOrEqual(windowMeasure(looseW) + 1e-6);
    for (const [s, e] of tightW) {
      expect(windowContains(looseW, (s + e) / 2)).toBe(true);
    }
  });

  it('fails loud with a typed error on a non-positive keep-out', async () => {
    await expect(
      computeAccess(spice, {
        observer: CASSINI, target: TARGET, span: [t0, t1], step: 120,
        constraints: [{ kind: 'sunExclusion', keepoutRad: 0 }],
      }),
    ).rejects.toBeInstanceOf(SunExclusionConstraintError);
  });
});
