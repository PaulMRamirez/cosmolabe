// RF link-budget physics validated against closed-form references: Friis path loss,
// parabolic gain, the textbook BPSK ~1e-5 BER at 9.6 dB, link-budget composition,
// and Doppler sign. (STK_PARITY_SPEC §4.5.)

import { describe, it, expect } from 'vitest';
import {
  friisPathLossDb,
  wavelengthM,
  parabolicGainDbi,
  halfPowerBeamwidthDeg,
  berBpsk,
  berQpsk,
  linkBudget,
  dopplerShiftHz,
  erfc,
} from './index.ts';

describe('erf/erfc', () => {
  it('matches known values', () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.15729920705, 6);
  });
});

describe('friisPathLossDb', () => {
  it('equals the hand-computed Friis loss at 2 GHz over 40000 km', () => {
    const d = 40000;
    const f = 2e9;
    const hand = 20 * Math.log10((4 * Math.PI * d * 1000) / wavelengthM(f));
    expect(friisPathLossDb(d, f)).toBeCloseTo(hand, 9);
    expect(friisPathLossDb(d, f)).toBeCloseTo(190.5, 1); // ~190.5 dB
  });
});

describe('parabolic antenna', () => {
  it('peak gain matches eta*(pi*D/lambda)^2', () => {
    const g = parabolicGainDbi(3.0, 8e9, 0.55);
    const lambda = wavelengthM(8e9);
    const hand = 10 * Math.log10(0.55 * (Math.PI * 3.0 / lambda) ** 2);
    expect(g).toBeCloseTo(hand, 9);
    expect(g).toBeGreaterThan(45); // a 3 m X-band dish is ~46 dBi
  });
  it('half-power beamwidth follows ~70 lambda/D', () => {
    expect(halfPowerBeamwidthDeg(3.0, 8e9)).toBeCloseTo((70 * wavelengthM(8e9)) / 3.0, 9);
  });
});

describe('modulation BER', () => {
  it('BPSK needs ~9.6 dB Eb/N0 for a 1e-5 bit error rate', () => {
    expect(berBpsk(9.6)).toBeGreaterThan(0.7e-5);
    expect(berBpsk(9.6)).toBeLessThan(1.3e-5);
  });
  it('QPSK BER equals BPSK vs Eb/N0', () => {
    expect(berQpsk(7)).toBe(berBpsk(7));
  });
  it('is monotonic decreasing in Eb/N0', () => {
    expect(berBpsk(10)).toBeLessThan(berBpsk(8));
  });
});

describe('linkBudget', () => {
  it('composes C/N0, Eb/N0, and margin', () => {
    const b = linkBudget({
      eirpDbW: 50,
      distanceKm: 40000,
      freqHz: 8e9,
      gOverTDbK: 30,
      dataRateBps: 1e6,
      otherLossesDb: 2,
      requiredEbN0Db: 4.4,
    });
    // C/N0 = EIRP - Lfs - other + G/T + 228.6
    const expectedCN0 = 50 - b.pathLossDb - 2 + 30 + 228.599;
    expect(b.cN0DbHz).toBeCloseTo(expectedCN0, 3);
    expect(b.ebN0Db).toBeCloseTo(b.cN0DbHz - 60, 3); // 10log10(1e6) = 60
    expect(b.marginDb).toBeCloseTo(b.ebN0Db - 4.4, 6);
  });
});

describe('dopplerShiftHz', () => {
  it('is negative when the range is opening (red shift)', () => {
    expect(dopplerShiftHz(8e9, 7.5)).toBeLessThan(0);
    expect(dopplerShiftHz(8e9, -7.5)).toBeGreaterThan(0);
    expect(dopplerShiftHz(8e9, 7.5)).toBeCloseTo(-8e9 * (7.5 / 299792.458), 3);
  });
});
