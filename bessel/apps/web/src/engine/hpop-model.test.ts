// The HPOP force-model builder layers terms by fidelity level. Validates each level
// builds a ForceModel that returns a finite acceleration at a representative LEO state.
// (STK_PARITY_SPEC §4.1/§4.2.)

import { describe, expect, it } from 'vitest';
import { buildHpopForceModel, HPOP_FORCE_MODEL_LABELS, type HpopForceModel } from './hpop-model.ts';

const EARTH = { gm: 398600.4418, re: 6378.137, j2: 1.08262668e-3 };
const LEO = { et: 0, r: [7000, 0, 0] as const, v: [0, 7.5, 0] as const };

describe('hpop force-model builder', () => {
  const levels: HpopForceModel[] = ['point-mass', 'j2', 'nxn', 'drag', 'srp'];

  it('builds a finite-acceleration model for every level', () => {
    for (const level of levels) {
      const fm = buildHpopForceModel(level, EARTH);
      const a = fm.acceleration(LEO);
      expect(a.length).toBe(3);
      for (const c of a) expect(Number.isFinite(c)).toBe(true);
      // The dominant central acceleration points back toward the body (-X here).
      expect(a[0]).toBeLessThan(0);
    }
  });

  it('labels every level', () => {
    for (const level of levels) expect(HPOP_FORCE_MODEL_LABELS[level]).toBeTruthy();
  });
});
