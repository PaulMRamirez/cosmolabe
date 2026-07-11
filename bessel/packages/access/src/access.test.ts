// Validates the access engine end to end against CSPICE references on the Cassini
// fixtures: line-of-sight access is the complement of the occultation (cross-checked
// with occult), and range-access boundaries sit at the threshold distance
// (cross-checked with spkpos). (STK_PARITY_SPEC §4.3, Phase A.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowMeasure, windowContains } from '@bessel/timeline';
import { computeAccess, computeChainAccess } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';

describe('@bessel/access computeAccess', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;

  const distanceTo = async (target: string, et: number): Promise<number> => {
    const p = await spice.spkpos(target, et, 'J2000', 'NONE', CASSINI);
    return Math.hypot(p.position.x, p.position.y, p.position.z);
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
  });

  it('returns the whole span when there are no constraints', async () => {
    const w = await computeAccess(spice, { observer: CASSINI, target: '10', span: [t0, t1], step: 120, constraints: [] });
    expect(w).toEqual([[t0, t1]]);
  });

  it('line-of-sight access is the complement of the occultation', async () => {
    const eclipse = await spice.gfoclt(
      'ANY', 'SATURN', 'ELLIPSOID', 'IAU_SATURN', 'SUN', 'POINT', 'J2000', 'NONE', CASSINI, 120, t0, t1,
    );
    expect(eclipse.length).toBeGreaterThan(0); // Cassini is shadowed near SOI

    const access = await computeAccess(spice, {
      observer: CASSINI,
      target: 'SUN',
      span: [t0, t1],
      step: 120,
      constraints: [{ kind: 'lineOfSight', body: 'SATURN', bodyFrame: 'IAU_SATURN' }],
    });

    // Access + eclipse partition the span.
    expect(windowMeasure(access) + windowMeasure(eclipse)).toBeCloseTo(t1 - t0, 3);

    // Inside the shadow: not in access, and occult confirms the Sun is occulted.
    const [es, ee] = eclipse[0]!;
    const shadowMid = (es + ee) / 2;
    expect(windowContains(access, shadowMid)).toBe(false);
    expect(
      await spice.occult('SUN', 'POINT', 'J2000', 'SATURN', 'ELLIPSOID', 'IAU_SATURN', 'NONE', CASSINI, shadowMid),
    ).toBeLessThan(0);

    // Just after the shadow: in access, and occult confirms no occultation.
    const sunlit = ee + 120;
    if (sunlit < t1) {
      expect(windowContains(access, sunlit)).toBe(true);
      expect(
        await spice.occult('SUN', 'POINT', 'J2000', 'SATURN', 'ELLIPSOID', 'IAU_SATURN', 'NONE', CASSINI, sunlit),
      ).toBe(0);
    }
  });

  it('range-access boundaries sit at the threshold distance', async () => {
    // Pick a threshold that the Cassini-Saturn distance crosses over the window.
    const samples = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map((h) => distanceTo('SATURN', t0 + h * 3600)),
    );
    const maxKm = (Math.min(...samples) + Math.max(...samples)) / 2;

    const access = await computeAccess(spice, {
      observer: CASSINI,
      target: 'SATURN',
      span: [t0, t1],
      step: 120,
      constraints: [{ kind: 'range', maxKm }],
    });
    expect(access.length).toBeGreaterThan(0);

    // Every boundary not at the span edge is where the distance equals the threshold.
    for (const [s, e] of access) {
      for (const b of [s, e]) {
        if (b === t0 || b === t1) continue;
        expect(Math.abs((await distanceTo('SATURN', b)) - maxKm)).toBeLessThan(1);
      }
    }
  });

  it('composing min and max range narrows the window (annulus subset of the disk)', async () => {
    const samples = await Promise.all([0, 2, 4, 6].map((h) => distanceTo('SATURN', t0 + h * 3600)));
    const lo = Math.min(...samples);
    const hi = Math.max(...samples);
    const maxKm = (lo + hi) / 2;
    const minKm = lo + (maxKm - lo) / 2;

    const disk = await computeAccess(spice, {
      observer: CASSINI, target: 'SATURN', span: [t0, t1], step: 120,
      constraints: [{ kind: 'range', maxKm }],
    });
    const annulus = await computeAccess(spice, {
      observer: CASSINI, target: 'SATURN', span: [t0, t1], step: 120,
      constraints: [{ kind: 'range', minKm, maxKm }],
    });
    expect(windowMeasure(annulus)).toBeLessThanOrEqual(windowMeasure(disk) + 1e-6);
  });

  it('chain access is the intersection of the hops and is up only when both are', async () => {
    const losLink = { observer: CASSINI, target: 'SUN', constraints: [{ kind: 'lineOfSight' as const, body: 'SATURN', bodyFrame: 'IAU_SATURN' }] };
    const samples = await Promise.all([0, 2, 4, 6].map((h) => distanceTo('SUN', t0 + h * 3600)));
    const maxKm = Math.max(...samples) + 1; // the Sun is always within range -> this hop is the whole span
    const rangeLink = { observer: CASSINI, target: 'SUN', constraints: [{ kind: 'range' as const, maxKm }] };

    const los = await computeAccess(spice, { observer: CASSINI, target: 'SUN', span: [t0, t1], step: 120, constraints: losLink.constraints });
    const chain = await computeChainAccess(spice, [losLink, rangeLink], [t0, t1], 120);

    // The always-up range hop leaves the chain equal to the line-of-sight hop.
    expect(windowMeasure(chain)).toBeCloseTo(windowMeasure(los), 2);
    // The chain is a subset of each hop.
    for (const [s, e] of chain) {
      expect(windowContains(los, (s + e) / 2)).toBe(true);
    }
  });
});
