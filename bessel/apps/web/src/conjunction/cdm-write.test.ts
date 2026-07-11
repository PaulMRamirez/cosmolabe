import { describe, it, expect } from 'vitest';
import { parseCdm } from '@bessel/interop';
import { writeCdm, type CdmRecord } from './cdm-write.ts';

// The CDM-style writer round-trips its key fields through the shared parseCdm: TCA, miss distance,
// relative speed, and the two object designators. The covariance block is emitted but not required
// to round-trip (parseCdm reads only the relative summary), so the test asserts it is present.

const record: CdmRecord = {
  tca: '2026-06-22T12:00:00.000Z',
  missDistanceM: 1234.5,
  relativeSpeedMS: 7500.25,
  collisionProbability: 1.23e-4,
  object1: { designator: 'CHASER-123' },
  object2: { designator: 'TARGET-456' },
  covariance: { cxx: 0.04, cxy: 0.01, cyy: 0.09 },
};

describe('writeCdm', () => {
  it('round-trips the TCA, miss, relative speed, and designators through parseCdm', () => {
    const parsed = parseCdm(writeCdm(record));
    expect(parsed.tca).toBe('2026-06-22T12:00:00.000Z');
    expect(parsed.missDistanceM).toBeCloseTo(1234.5, 6);
    expect(parsed.relativeSpeedMS).toBeCloseTo(7500.25, 6);
    expect(parsed.object1.designator).toBe('CHASER-123');
    expect(parsed.object2.designator).toBe('TARGET-456');
  });

  it('emits the CCSDS version header and the collision probability', () => {
    const text = writeCdm(record);
    expect(text).toContain('CCSDS_CDM_VERS');
    expect(text).toContain('COLLISION_PROBABILITY');
    expect(text).toContain('TCA = 2026-06-22T12:00:00.000Z');
  });

  it('emits the encounter-plane covariance keys when a covariance is supplied', () => {
    const text = writeCdm(record);
    expect(text).toContain('CR_R');
    expect(text).toContain('CT_R');
    expect(text).toContain('CT_T');
  });

  it('omits the covariance block when none is supplied', () => {
    const { covariance: _omit, ...noCov } = record;
    const text = writeCdm(noCov);
    expect(text).not.toContain('CR_R');
    // The summary still round-trips without a covariance block.
    const parsed = parseCdm(text);
    expect(parsed.object1.designator).toBe('CHASER-123');
  });

  it('is deterministic (no wall-clock): the same record serializes identically', () => {
    expect(writeCdm(record)).toBe(writeCdm(record));
  });
});
