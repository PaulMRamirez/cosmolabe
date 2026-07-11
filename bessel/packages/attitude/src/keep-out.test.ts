// Keep-out geometry and windowing: angular separation, the in-cone test, and a
// windowed analysis whose intervals match a sweeping body direction. The SPICE call is
// faked so the window logic is checked without kernels. (STK_PARITY_SPEC §4.6.)

import { describe, it, expect } from 'vitest';
import type { SpiceEngine, Vec3 } from '@bessel/spice';
import { angularSeparationRad, withinKeepOut, keepOutWindow } from './keep-out.ts';
import { windowMeasure } from '@bessel/timeline';

describe('angularSeparationRad / withinKeepOut', () => {
  it('measures the angle between directions', () => {
    expect(angularSeparationRad({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(angularSeparationRad({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0, 9);
  });

  it('flags directions inside the keep-out cone', () => {
    const sun: Vec3 = { x: 1, y: 0, z: 0 };
    const near: Vec3 = { x: Math.cos(0.1), y: Math.sin(0.1), z: 0 }; // 0.1 rad off
    const far: Vec3 = { x: 0, y: 1, z: 0 }; // 90 deg off
    expect(withinKeepOut(near, sun, 0.2)).toBe(true);
    expect(withinKeepOut(far, sun, 0.2)).toBe(false);
  });
});

describe('keepOutWindow', () => {
  it('finds the intervals where the boresight stays outside the cone', async () => {
    // The body direction sweeps in the x-y plane: angle = omega * et. The boresight is
    // fixed at +x. The constraint is satisfied when the body is > halfAngle from +x.
    const omega = (2 * Math.PI) / 100; // one full sweep over 100 s
    const spice = {
      spkpos: async (_t: string, et: number) => ({
        position: { x: Math.cos(omega * et), y: Math.sin(omega * et), z: 0 },
        lightTime: 0,
      }),
    } as unknown as SpiceEngine;

    const halfAngle = 0.3;
    const win = await keepOutWindow(spice, {
      observer: '-99',
      exclusionBody: 'SUN',
      halfAngleRad: halfAngle,
      boresightAt: () => ({ x: 1, y: 0, z: 0 }),
      span: [0, 100],
      step: 1,
    });

    // Over one full sweep the body is within halfAngle of +x for a fraction
    // 2*halfAngle/(2*pi) of the period (near et=0 and et=100). The satisfied measure is
    // the complement.
    const violatedFraction = (2 * halfAngle) / (2 * Math.PI);
    const expectedSatisfied = 100 * (1 - violatedFraction);
    expect(windowMeasure(win)).toBeCloseTo(expectedSatisfied, 0);
  });
});
