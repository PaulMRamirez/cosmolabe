// The impulsive-burn primitive: a prograde VNB burn raises speed by exactly |dv|, leaves
// position untouched, and never mutates the input state. Finite/Isp burns fail loudly.
// (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { applyImpulsive } from './maneuver.ts';
import { NotImplementedError } from './errors.ts';
import type { MissionState } from './state.ts';
import type { ManeuverSegment } from './segments.ts';

const S: MissionState = {
  epoch: 100,
  r: { x: 7000, y: 0, z: 0 },
  v: { x: 0, y: 7.546, z: 0 },
  mass: 1000,
  centralBody: 399,
  segmentPath: ['root'],
};

describe('applyImpulsive', () => {
  it('adds a prograde VNB delta-v to the speed and keeps r and epoch', () => {
    const seg: ManeuverSegment = { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.2, y: 0, z: 0 } };
    const out = applyImpulsive(S, seg);
    expect(Math.hypot(out.v.x, out.v.y, out.v.z)).toBeCloseTo(7.546 + 0.2, 12);
    expect(out.r).toEqual(S.r);
    expect(out.epoch).toBe(100);
    expect(out.segmentPath).toEqual(['root', 'burn']);
  });

  it('does not mutate the input state', () => {
    const seg: ManeuverSegment = { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.2, y: 0, z: 0 } };
    applyImpulsive(S, seg);
    expect(S.v).toEqual({ x: 0, y: 7.546, z: 0 });
    expect(S.segmentPath).toEqual(['root']);
  });

  it('rejects a finite-burn maneuver', () => {
    const seg: ManeuverSegment = { kind: 'Maneuver', id: 'b', mode: 'Finite', attitude: 'VNB', dv: { x: 0.1, y: 0, z: 0 } };
    expect(() => applyImpulsive(S, seg)).toThrow(NotImplementedError);
  });

  it('rejects an Isp (mass-depleting) maneuver', () => {
    const seg: ManeuverSegment = { kind: 'Maneuver', id: 'b', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.1, y: 0, z: 0 }, isp: 300 };
    expect(() => applyImpulsive(S, seg)).toThrow(NotImplementedError);
  });
});
