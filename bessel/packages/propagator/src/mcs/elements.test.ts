// Kepler element math, validated by round-trip (coe2rv then rv2coe is the identity) and
// against closed forms for the simple cases. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import type { Vec3 } from '@bessel/spice';
import { coe2rv, rv2coe, trueAnomalyOf } from './elements.ts';
import { DegenerateElementsError } from './errors.ts';
import type { KeplerianElements } from './segments.ts';

const MU = 398600.4418;

const cases: [string, KeplerianElements][] = [
  ['eccentric inclined', { sma: 8000, ecc: 0.1, inc: 0.5, raan: 0.7, argp: 0.3, trueAnomaly: 1.2 }],
  ['low eccentricity', { sma: 7200, ecc: 0.001, inc: 0.9, raan: 1.5, argp: 2.1, trueAnomaly: 0.4 }],
  ['high inclination', { sma: 7000, ecc: 0.2, inc: 1.7, raan: 0.2, argp: 1.0, trueAnomaly: 3.0 }],
];

describe('coe2rv / rv2coe round-trip', () => {
  for (const [label, el] of cases) {
    it(`recovers the elements for the ${label} orbit`, () => {
      const { r, v } = coe2rv(MU, el);
      const back = rv2coe(MU, r, v);
      expect(back.sma).toBeCloseTo(el.sma, 6);
      expect(back.ecc).toBeCloseTo(el.ecc, 9);
      expect(back.inc).toBeCloseTo(el.inc, 9);
      expect(back.raan).toBeCloseTo(el.raan, 9);
      expect(back.argp).toBeCloseTo(el.argp, 8);
      expect(back.trueAnomaly).toBeCloseTo(el.trueAnomaly, 8);
    });
  }

  it('gives apsis radii and a circular-orbit collapse', () => {
    const el: KeplerianElements = { sma: 7000, ecc: 0, inc: 0.4, raan: 0, argp: 0, trueAnomaly: 0 };
    const { r, v } = coe2rv(MU, el);
    const coe = rv2coe(MU, r, v);
    expect(coe.sma).toBeCloseTo(7000, 6);
    expect(coe.ecc).toBeLessThan(1e-12);
    expect(coe.raApo).toBeCloseTo(7000, 6);
    expect(coe.raPeri).toBeCloseTo(7000, 6);
  });

  it('reports the apsis radii for an eccentric orbit', () => {
    const coe = rv2coe(MU, ...rvArr({ sma: 10000, ecc: 0.3, inc: 0.5, raan: 0, argp: 0, trueAnomaly: 0 }));
    expect(coe.raPeri).toBeCloseTo(7000, 3); // a(1-e)
    expect(coe.raApo).toBeCloseTo(13000, 3); // a(1+e)
  });

  it('flight-path angle is zero at periapsis and apoapsis', () => {
    const peri = rv2coe(MU, ...rvArr({ sma: 9000, ecc: 0.25, inc: 0.6, raan: 0.1, argp: 0.2, trueAnomaly: 0 }));
    const apo = rv2coe(MU, ...rvArr({ sma: 9000, ecc: 0.25, inc: 0.6, raan: 0.1, argp: 0.2, trueAnomaly: Math.PI }));
    expect(Math.abs(peri.fpa)).toBeLessThan(1e-9);
    expect(Math.abs(apo.fpa)).toBeLessThan(1e-9);
  });

  it('trueAnomalyOf matches the seeded anomaly', () => {
    const { r, v } = coe2rv(MU, { sma: 8000, ecc: 0.15, inc: 0.5, raan: 0.3, argp: 0.8, trueAnomaly: 2.0 });
    expect(trueAnomalyOf(MU, r, v)).toBeCloseTo(2.0, 8);
  });

  it('rejects a parabolic orbit', () => {
    expect(() => coe2rv(MU, { sma: 8000, ecc: 1, inc: 0.5, raan: 0, argp: 0, trueAnomaly: 0 })).toThrow(
      DegenerateElementsError,
    );
  });
});

function rvArr(el: KeplerianElements): [Vec3, Vec3] {
  const { r, v } = coe2rv(MU, el);
  return [r, v];
}
