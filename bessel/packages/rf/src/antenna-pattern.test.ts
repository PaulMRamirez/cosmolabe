// Antenna pattern, pointing loss, and polarization mismatch validated against
// published references: -3 dB at the half-power point (IEEE Std 149 main lobe and
// the standard Gaussian main lobe), 0 dB at boresight, monotonic decay, and the
// classic polarization mismatch values (linear->circular = 3.01 dB, linear-linear
// at 60 deg = 6.02 dB, matched circular = 0). (STK_PARITY_SPEC §4.5.)

import { describe, it, expect } from 'vitest';
import {
  antennaPatternLossDb,
  pointingLossDb,
  polarizationLossDb,
  PATTERN_NULL_FLOOR_DB,
  POLARIZATION_NULL_FLOOR_DB,
} from './index.ts';

describe('antennaPatternLossDb', () => {
  it('is 0 dB at boresight for both models', () => {
    expect(antennaPatternLossDb('parabolic', 2, 0)).toBeCloseTo(0, 9);
    expect(antennaPatternLossDb('gaussian', 2, 0)).toBeCloseTo(0, 9);
  });

  it('is -3 dB at the half-power point (off = HPBW/2) for both models', () => {
    const hpbw = 2.4;
    // Parabolic IEEE main lobe: -12*(0.5)^2 = -3.0 dB exactly.
    expect(antennaPatternLossDb('parabolic', hpbw, hpbw / 2)).toBeCloseTo(-3.0, 9);
    // Gaussian main lobe is tuned to the half-power point: -3.01 dB.
    expect(antennaPatternLossDb('gaussian', hpbw, hpbw / 2)).toBeCloseTo(-3.01, 2);
    // Both are within rounding of the -3 dB half-power definition.
    expect(antennaPatternLossDb('parabolic', hpbw, hpbw / 2)).toBeCloseTo(-3, 1);
    expect(antennaPatternLossDb('gaussian', hpbw, hpbw / 2)).toBeCloseTo(-3, 1);
  });

  it('is symmetric in off-boresight sign', () => {
    expect(antennaPatternLossDb('parabolic', 2, 0.7)).toBeCloseTo(
      antennaPatternLossDb('parabolic', 2, -0.7),
      9,
    );
  });

  it('is monotonic decreasing with off-boresight angle', () => {
    const a = antennaPatternLossDb('parabolic', 2, 0.2);
    const b = antennaPatternLossDb('parabolic', 2, 0.5);
    const c = antennaPatternLossDb('parabolic', 2, 0.9);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('clamps to the deep-null floor far off boresight', () => {
    expect(antennaPatternLossDb('parabolic', 1, 100)).toBe(PATTERN_NULL_FLOOR_DB);
    expect(antennaPatternLossDb('gaussian', 1, 100)).toBe(PATTERN_NULL_FLOOR_DB);
  });

  it('throws a typed error on a non-positive beamwidth', () => {
    expect(() => antennaPatternLossDb('parabolic', 0, 1)).toThrow(RangeError);
  });

  it('pointingLossDb is the same as antennaPatternLossDb', () => {
    expect(pointingLossDb('parabolic', 2, 0.6)).toBe(antennaPatternLossDb('parabolic', 2, 0.6));
  });
});

describe('polarizationLossDb', () => {
  it('linear to linear aligned is 0 dB', () => {
    expect(polarizationLossDb('linear', 'linear', 0)).toBeCloseTo(0, 9);
  });

  it('linear to linear misaligned by 60 deg is -6.02 dB', () => {
    // -10*log10(cos(60)^2) = -10*log10(0.25) = 6.0206 dB loss.
    expect(polarizationLossDb('linear', 'linear', 60)).toBeCloseTo(-6.0206, 3);
  });

  it('linear to circular (either sense) is -3.01 dB', () => {
    expect(polarizationLossDb('linear', 'rhcp')).toBeCloseTo(-3.0103, 3);
    expect(polarizationLossDb('linear', 'lhcp')).toBeCloseTo(-3.0103, 3);
    expect(polarizationLossDb('rhcp', 'linear')).toBeCloseTo(-3.0103, 3);
  });

  it('same-sense circular is 0 dB', () => {
    expect(polarizationLossDb('rhcp', 'rhcp')).toBe(0);
    expect(polarizationLossDb('lhcp', 'lhcp')).toBe(0);
  });

  it('opposite-sense circular is the deep cross-polar null', () => {
    expect(polarizationLossDb('rhcp', 'lhcp')).toBe(POLARIZATION_NULL_FLOOR_DB);
    expect(polarizationLossDb('lhcp', 'rhcp')).toBe(POLARIZATION_NULL_FLOOR_DB);
  });

  it('linear to linear at 90 deg is the deep null', () => {
    expect(polarizationLossDb('linear', 'linear', 90)).toBe(POLARIZATION_NULL_FLOOR_DB);
  });
});
