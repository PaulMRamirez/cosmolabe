// Harris-Priester atmosphere. Independent oracles (not circular):
//   (1) at a table altitude the day-side (apex) density equals the published rhoMax
//       and the night-side (antapex) density equals rhoMin (Montenbruck & Gill
//       Table 3.8, mean solar activity), converted g/km^3 -> kg/km^3.
//   (2) it drives the same drag term as the exponential model and lies in the same
//       order of magnitude at 400 km (the exponential value falls between HP min/max).
//   (3) density is C0-continuous in altitude (no jump across a band boundary) and the
//       diurnal weighting is C0-continuous in position.
//   (4) it fails loudly outside the tabulated altitude span.
// This is the standard Harris-Priester model, NOT full NRLMSISE-00 (no F10.7/Ap
// space-weather drivers). References: Montenbruck & Gill section 3.5. (STK §4.1.)

import { describe, it, expect } from 'vitest';
import { harrisPriesterAtmosphere, HARRIS_PRIESTER_MEAN } from './force/harris-priester.ts';
import { exponentialAtmosphere, DragError } from './force/drag.ts';
import type { Vector3 } from './force/types.ts';

const RE = 6378.137;
const G_TO_KG = 1e-3; // g/km^3 -> kg/km^3

describe('harrisPriesterAtmosphere', () => {
  it('matches the published day/night densities at a table altitude (400 km)', () => {
    // M&G Table 3.8 at 400 km: rho_min = 2.249, rho_max = 7.492 g/km^3.
    const apex: Vector3 = [1, 0, 0];
    const atm = harrisPriesterAtmosphere({ re: RE, bulgeApex: apex, exponent: 2 });
    // Day side: position aligned with the apex -> cos(psi)=1 -> weight 1 -> rhoMax.
    const day = atm.density([RE + 400, 0, 0]);
    expect(day).toBeCloseTo(7.492 * G_TO_KG, 6);
    // Night side: position anti-aligned -> cos(psi)=-1 -> weight 0 -> rhoMin.
    const night = atm.density([-(RE + 400), 0, 0]);
    expect(night).toBeCloseTo(2.249 * G_TO_KG, 6);
    // Terminator (perpendicular): weight 0.5 -> the mean of min and max.
    const term = atm.density([0, RE + 400, 0]);
    expect(term).toBeCloseTo(((2.249 + 7.492) / 2) * G_TO_KG, 6);
  });

  it('brackets the exponential-model density at 400 km (independent cross-check)', () => {
    const hp = harrisPriesterAtmosphere({ re: RE });
    const exp = exponentialAtmosphere({ re: RE });
    const rExp = exp.density([RE + 400, 0, 0]); // ~3.725e-3 kg/km^3
    const day = hp.density([RE + 400, 0, 0]);
    const night = hp.density([-(RE + 400), 0, 0]);
    expect(rExp).toBeGreaterThan(night);
    expect(rExp).toBeLessThan(day);
  });

  it('is C0-continuous in altitude across a band boundary', () => {
    // 420 km is a table node; approaching it from below and above must agree.
    const atm = harrisPriesterAtmosphere({ re: RE });
    const at = (h: number) => atm.density([RE + h, 0, 0]);
    const eps = 1e-4;
    const below = at(420 - eps);
    const node = at(420);
    const above = at(420 + eps);
    expect(below).toBeCloseTo(node, 6);
    expect(above).toBeCloseTo(node, 6);
  });

  it('density decreases monotonically with altitude (day side)', () => {
    const atm = harrisPriesterAtmosphere({ re: RE, bulgeApex: [1, 0, 0] });
    let prev = Infinity;
    for (let h = 200; h <= 1000; h += 25) {
      const rho = atm.density([RE + h, 0, 0]);
      expect(rho).toBeLessThan(prev);
      prev = rho;
    }
  });

  it('is C0-continuous in the diurnal weighting as the bulge sweeps', () => {
    const atm = harrisPriesterAtmosphere({ re: RE, bulgeApex: [1, 0, 0], exponent: 4 });
    const r = RE + 500;
    let prev = atm.density([r, 0, 0]);
    // Rotate the sample point around the apex; density must vary smoothly (no jumps).
    for (let deg = 1; deg <= 180; deg++) {
      const a = (deg * Math.PI) / 180;
      const rho = atm.density([r * Math.cos(a), r * Math.sin(a), 0]);
      expect(Math.abs(rho - prev)).toBeLessThan(0.05 * Math.max(rho, prev) + 1e-9);
      prev = rho;
    }
  });

  it('fails loudly outside the tabulated altitude span', () => {
    const atm = harrisPriesterAtmosphere({ re: RE });
    expect(() => atm.density([RE + 50, 0, 0])).toThrow(DragError);
    expect(() => atm.density([RE + 2000, 0, 0])).toThrow(DragError);
  });

  it('rejects a non-ascending table', () => {
    expect(() =>
      harrisPriesterAtmosphere({ re: RE, table: [HARRIS_PRIESTER_MEAN[1]!, HARRIS_PRIESTER_MEAN[0]!] }),
    ).toThrow(DragError);
  });
});
