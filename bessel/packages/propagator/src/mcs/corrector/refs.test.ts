// Angular goal residuals must wrap. A periodic element goal (RAAN, ArgP) lives on the circle
// [0, 2pi): a raw achieved - desired residual near the 0/2pi seam (desired ~0.02, achieved ~6.27)
// reads as a spurious ~2pi miss and triggers a false DcNotConverged. The wrapped residual must be
// the short way round (~0.03), so the convergence test and the FD Jacobian see the true distance.
// Inclination lives in [0, pi] and must NOT wrap. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { bindGoals } from './refs.ts';
import { coe2rv, rv2coe } from '../elements.ts';
import type { MissionState } from '../state.ts';

const MU = 398600.4418;

/** A MissionState built from classical elements, so its achieved RAAN/Inc are known. */
function stateFromCoe(raan: number, inc: number): MissionState {
  const { r, v } = coe2rv(MU, { sma: 8000, ecc: 0.05, inc, raan, argp: 0.3, trueAnomaly: 0.4 });
  return { epoch: 0, r, v, mass: 1000, centralBody: 399, segmentPath: ['s'] };
}

describe('periodic angular goal residual wrapping', () => {
  it('wraps a RAAN residual near the 0/2pi seam to the short way round', () => {
    // Achieved RAAN ~6.27 rad (just below 2pi); desired 0.02 rad (just above 0). The true miss is
    // ~0.03 rad the short way, not ~6.25 rad the long way.
    const achievedRaan = 6.27;
    const desiredRaan = 0.02;
    const s = stateFromCoe(achievedRaan, 0.6);
    const measured = rv2coe(MU, s.r, s.v).raan;
    expect(measured).toBeCloseTo(achievedRaan, 6); // sanity: the state really has that RAAN

    const [goal] = bindGoals([{ evalAt: 'End', type: 'RAAN', desired: desiredRaan, tolerance: 1e-3 }]);
    const resid = goal!.residual(s, MU);

    // Short way: |resid| ~ 0.03, well under pi; the un-wrapped residual would be ~ -6.25.
    expect(Math.abs(resid)).toBeLessThan(Math.PI);
    expect(Math.abs(resid)).toBeCloseTo((2 * Math.PI - achievedRaan) + desiredRaan, 6);
    // A modest tolerance bracketing the true miss would now converge (raw -6.25 never would).
    expect(Math.abs(resid) <= 0.05).toBe(true);
  });

  it('reports a near-zero wrapped residual when achieved nearly equals desired across the seam', () => {
    // Desired 6.2820 rad, achieved ~6.2815 rad: a genuine match. Without wrapping a tiny seam
    // crossing could still read large; with wrapping it is ~0.
    const achievedRaan = 6.2815;
    const s = stateFromCoe(achievedRaan, 0.6);
    const [goal] = bindGoals([{ evalAt: 'End', type: 'RAAN', desired: 0.001, tolerance: 1e-3 }]);
    const resid = goal!.residual(s, MU);
    // achieved 6.2815, desired 0.001: raw delta 6.2805 wraps to 6.2805 - 2pi ~ -0.00269.
    expect(resid).toBeCloseTo(achievedRaan - 0.001 - 2 * Math.PI, 6);
    expect(Math.abs(resid)).toBeLessThan(0.01);
  });

  it('does NOT wrap an inclination residual (Inc is not periodic on the circle)', () => {
    // Inc lives in [0, pi]; a residual of (achieved - desired) must stay raw, never wrapped.
    const s = stateFromCoe(0.5, 2.8); // inc ~2.8 rad
    const [goal] = bindGoals([{ evalAt: 'End', type: 'Inc', desired: 0.1, tolerance: 1e-3 }]);
    const resid = goal!.residual(s, MU);
    const measuredInc = rv2coe(MU, s.r, s.v).inc;
    expect(resid).toBeCloseTo(measuredInc - 0.1, 9); // raw, no wrap (~2.7)
    expect(resid).toBeGreaterThan(2.5);
  });
});
