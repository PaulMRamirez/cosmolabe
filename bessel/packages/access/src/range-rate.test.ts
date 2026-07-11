// Oracle test for the range-rate constraint on the Cassini fixtures. Two independent checks:
// (1) the analytic range rate from spkezr ((r . v) / |r|) matches a central finite difference
// of the range (|spkpos|) to a tight tolerance, so the closed-form derivative is correct; and
// (2) the constraint window for maxKmS = 0 is exactly the "approaching" (negative range rate)
// span: the range strictly decreases inside it and increases just outside, and each interior
// edge sits where the range rate crosses zero (a closest or farthest approach).
// (STK_PARITY_SPEC §4.3, ACC range-rate.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowContains } from '@bessel/timeline';
import { computeAccess, rangeRateFromState, RangeRateConstraintError } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';
const TARGET = 'SATURN';

describe('@bessel/access rangeRate constraint', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;

  const rangeAt = async (et: number): Promise<number> => {
    const p = await spice.spkpos(TARGET, et, 'J2000', 'NONE', CASSINI);
    return Math.hypot(p.position.x, p.position.y, p.position.z);
  };

  const analyticRangeRate = async (et: number): Promise<number> =>
    rangeRateFromState(await spice.spkezr(TARGET, et, 'J2000', 'NONE', CASSINI));

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
  });

  it('analytic range rate matches a finite difference of the range', async () => {
    const h = 1; // 1 second central difference
    for (let i = 1; i <= 11; i++) {
      const et = t0 + (i / 12) * (t1 - t0);
      const fd = ((await rangeAt(et + h)) - (await rangeAt(et - h))) / (2 * h);
      const analytic = await analyticRangeRate(et);
      // Central difference is O(h^2) accurate; the range rate here is on the order of km/s.
      expect(analytic).toBeCloseTo(fd, 4);
    }
  });

  it('maxKmS = 0 yields the approaching window: range falls inside, rises outside', async () => {
    const access = await computeAccess(spice, {
      observer: CASSINI,
      target: TARGET,
      span: [t0, t1],
      step: 120,
      constraints: [{ kind: 'rangeRate', maxKmS: 0 }],
    });
    expect(access.length).toBeGreaterThan(0);

    for (const [s, e] of access) {
      // Inside an approaching interval the range strictly decreases (negative range rate),
      // so the end is closer than the start and the analytic rate at the midpoint is < 0.
      expect(await rangeAt(e)).toBeLessThan(await rangeAt(s));
      expect(await analyticRangeRate((s + e) / 2)).toBeLessThan(0);
      expect(windowContains(access, (s + e) / 2)).toBe(true);

      // Each interior edge is a range-rate zero crossing (closest/farthest approach).
      for (const b of [s, e]) {
        if (b === t0 || b === t1) continue;
        expect(Math.abs(await analyticRangeRate(b))).toBeLessThan(1e-3);
      }

      // Just outside the trailing edge the target is receding again (range rate > 0).
      const after = e + 120;
      if (after < t1) {
        expect(await analyticRangeRate(after)).toBeGreaterThan(0);
        expect(windowContains(access, after)).toBe(false);
      }
    }
  });

  it('fails loud with a typed error when neither bound is given', async () => {
    await expect(
      computeAccess(spice, {
        observer: CASSINI,
        target: TARGET,
        span: [t0, t1],
        step: 120,
        constraints: [{ kind: 'rangeRate' }],
      }),
    ).rejects.toBeInstanceOf(RangeRateConstraintError);
  });
});
