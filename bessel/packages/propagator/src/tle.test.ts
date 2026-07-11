// TLE parser, validated against the canonical Vallado SGP4 verification set
// (catalog 00005): decoded elements match the published values, the checksum
// validates, and corrupted input fails loudly.

import { describe, it, expect } from 'vitest';
import { parseTle, TleError } from './tle.ts';

// AIAA-2006-6753 / Vallado SGP4-VER catalog 00005.
const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';
const DEG = Math.PI / 180;

describe('parseTle', () => {
  it('decodes the catalog-5 elements to the published values', () => {
    const t = parseTle(L1, L2);
    expect(t.satnum).toBe(5);
    expect(t.inclination).toBeCloseTo(34.2682 * DEG, 9);
    expect(t.raan).toBeCloseTo(348.7242 * DEG, 9);
    expect(t.eccentricity).toBeCloseTo(0.1859667, 9);
    expect(t.argp).toBeCloseTo(331.7664 * DEG, 9);
    expect(t.meanAnomaly).toBeCloseTo(19.3264 * DEG, 9);
    expect(t.meanMotion).toBeCloseTo(10.82419157, 7);
    expect(t.bstar).toBeCloseTo(0.28098e-4, 12);
  });

  it('decodes the epoch (day 179.78 of 2000) to a UTC ISO string', () => {
    const t = parseTle(L1, L2);
    expect(t.epochUtc.startsWith('2000-06-27T')).toBe(true);
  });

  it('rejects a corrupted checksum', () => {
    const bad = L1.slice(0, 68) + '0'; // wrong last-digit checksum
    expect(() => parseTle(bad, L2)).toThrow(TleError);
  });

  it('rejects mismatched satellite numbers across the two lines', () => {
    const l2 = '2 00006  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413668';
    expect(() => parseTle(L1, l2)).toThrow(TleError);
  });

  it('rejects lines with the wrong leading digit', () => {
    expect(() => parseTle(L2, L1)).toThrow(TleError);
  });
});
