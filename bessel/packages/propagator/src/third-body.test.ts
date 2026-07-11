// Third-body perturbation term: the indirect term must be present (so a satellite at
// the central-body focus feels zero net third-body acceleration), the tidal sign is
// correct, and the sampled-position interpolator brackets and clamps correctly. Pure
// (no kernels); a numeric parity check against a reference trajectory is deferred,
// there is no committed fixture. (STK_PARITY_SPEC §4.2.)

import { describe, it, expect } from 'vitest';
import { thirdBody, sampledPosition } from './force/third-body.ts';
import type { ForceContext } from './force/types.ts';

const ctx = (r: [number, number, number]): ForceContext => ({ et: 0, r, v: [0, 0, 0] });
const GM_SUN = 1.32712440018e11;

describe('thirdBody', () => {
  it('gives zero net acceleration at the central-body focus (indirect term present)', () => {
    // At r = 0 the direct and indirect terms cancel exactly; without the indirect
    // term this would be the full direct attraction toward the body.
    const term = thirdBody('SUN', GM_SUN, () => [1.5e8, 0, 0]);
    const a = term.acceleration(ctx([0, 0, 0]));
    expect(Math.hypot(a[0], a[1], a[2])).toBeLessThan(1e-12);
  });

  it('stretches along the line to the third body (tidal sign)', () => {
    const sun: [number, number, number] = [1.5e8, 0, 0];
    const term = thirdBody('SUN', GM_SUN, () => sun);
    // A satellite displaced toward the Sun feels a net pull further toward the Sun.
    const a = term.acceleration(ctx([7000, 0, 0]));
    expect(a[0]).toBeGreaterThan(0);
  });
});

describe('sampledPosition', () => {
  const et = Float64Array.of(0, 10, 20);
  const pos = Float64Array.of(0, 0, 0, 10, 20, 30, 30, 60, 90);
  const interp = sampledPosition(et, pos);

  it('linearly interpolates within the grid', () => {
    expect(interp(5)).toEqual([5, 10, 15]);
    expect(interp(15)).toEqual([20, 40, 60]);
  });

  it('clamps to the endpoints outside the grid', () => {
    expect(interp(-100)).toEqual([0, 0, 0]);
    expect(interp(999)).toEqual([30, 60, 90]);
  });
});
