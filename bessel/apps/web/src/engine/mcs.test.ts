// The mission-design helper builds a valid MCS, runs it, and reduces it to a result
// whose differential corrector converges on the target radius. Validates the IR is
// accepted and the convergence report surfaces. (STK_PARITY_SPEC §4.3.)

import { describe, expect, it } from 'vitest';
import { buildMcs, DEFAULT_MCS_DESIGN, runMcsDesign } from './mcs.ts';

describe('mcs design helper', () => {
  it('builds a valid Mcs IR for the default design', () => {
    const mcs = buildMcs(DEFAULT_MCS_DESIGN);
    expect(mcs.version).toBe(1);
    expect(mcs.root.kind).toBe('Sequence');
    expect(mcs.root.children[0]?.kind).toBe('InitialState');
  });

  it('runs the sequence, converges the corrector, and reaches the target radius', async () => {
    const { result, arc } = await runMcsDesign(DEFAULT_MCS_DESIGN);
    expect(arc.length).toBeGreaterThan(2);
    expect(result.altitude.et.length).toBe(result.altitude.value.length);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.goals.length).toBe(1);
    // The corrector drives the final radius to the desired value within tolerance.
    expect(Math.abs(result.finalRadiusKm - DEFAULT_MCS_DESIGN.targetRadiusKm)).toBeLessThan(1);
    expect(result.goals[0]?.satisfied).toBe(true);
  });
});
