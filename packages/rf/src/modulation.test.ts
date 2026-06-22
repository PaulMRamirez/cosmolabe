// Higher-order modulation BER and modcod table validated against closed-form
// references: M-PSK with M=2 reduces to the existing BPSK curve, QPSK (M=4) equals
// BPSK vs Eb/N0, the uncoded BPSK ~9.6 dB at 1e-5 threshold, and a textbook
// 16-QAM BER (~1.75e-3 at 10 dB Eb/N0). (STK_PARITY_SPEC §4.5.)

import { describe, it, expect } from 'vitest';
import {
  berMpsk,
  berMqam,
  berBpsk,
  linkMarginDb,
  MODCOD_TABLE,
  ModulationError,
} from './index.ts';

describe('berMpsk', () => {
  it('M=2 equals the existing berBpsk across Eb/N0', () => {
    for (const ebN0 of [0, 4, 7, 9.6, 12]) {
      expect(berMpsk(2, ebN0)).toBeCloseTo(berBpsk(ebN0), 12);
    }
  });

  it('QPSK (M=4) equals BPSK vs Eb/N0 (Gray-coded approximation)', () => {
    // sin(pi/4)=1/sqrt(2), k=2, so the argument reduces to sqrt(Eb/N0): same curve.
    expect(berMpsk(4, 7)).toBeCloseTo(berBpsk(7), 9);
  });

  it('uncoded BPSK reaches a ~1e-5 BER near 9.6 dB', () => {
    expect(berMpsk(2, 9.6)).toBeGreaterThan(0.7e-5);
    expect(berMpsk(2, 9.6)).toBeLessThan(1.3e-5);
  });

  it('higher-order PSK needs more Eb/N0 for the same BER', () => {
    expect(berMpsk(8, 10)).toBeGreaterThan(berMpsk(4, 10));
  });

  it('is monotonic decreasing in Eb/N0', () => {
    expect(berMpsk(8, 12)).toBeLessThan(berMpsk(8, 9));
  });

  it('throws a typed error for a non-power-of-two M', () => {
    expect(() => berMpsk(6, 10)).toThrow(ModulationError);
    expect(() => berMpsk(3, 10)).toThrow(ModulationError);
  });
});

describe('berMqam', () => {
  it('matches the textbook 16-QAM BER at 10 dB Eb/N0 (~1.75e-3)', () => {
    expect(berMqam(16, 10)).toBeCloseTo(1.75e-3, 4);
  });

  it('64-QAM is worse than 16-QAM at the same Eb/N0', () => {
    expect(berMqam(64, 12)).toBeGreaterThan(berMqam(16, 12));
  });

  it('is monotonic decreasing in Eb/N0', () => {
    expect(berMqam(16, 14)).toBeLessThan(berMqam(16, 10));
  });

  it('throws on a non-square constellation (odd log2 M)', () => {
    expect(() => berMqam(8, 10)).toThrow(ModulationError);
    expect(() => berMqam(32, 10)).toThrow(ModulationError);
  });

  it('throws on a non-power-of-two M', () => {
    expect(() => berMqam(12, 10)).toThrow(ModulationError);
  });
});

describe('MODCOD_TABLE and linkMarginDb', () => {
  it('contains the uncoded BPSK entry at ~9.6 dB required Eb/N0', () => {
    const bpsk = MODCOD_TABLE.find((m) => m.name === 'uncoded-bpsk');
    expect(bpsk).toBeDefined();
    expect(bpsk!.requiredEbN0Db).toBeCloseTo(9.6, 6);
    expect(bpsk!.codeRate).toBe(1);
  });

  it('coded entries require less Eb/N0 than uncoded BPSK', () => {
    const uncoded = MODCOD_TABLE.find((m) => m.name === 'uncoded-bpsk')!;
    const coded = MODCOD_TABLE.find((m) => m.name === 'ccsds-conv-rs')!;
    expect(coded.requiredEbN0Db).toBeLessThan(uncoded.requiredEbN0Db);
  });

  it('linkMarginDb is achieved minus required', () => {
    expect(linkMarginDb(12.5, 9.6)).toBeCloseTo(2.9, 6);
    expect(linkMarginDb(8.0, 9.6)).toBeCloseTo(-1.6, 6);
  });
});
