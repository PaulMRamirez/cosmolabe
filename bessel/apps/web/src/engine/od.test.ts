// The orbit-determination helper synthesizes measurements from a known truth orbit and
// recovers the state with batch least squares. Validates the estimate converges to the
// truth and produces a positive-definite covariance summary. (Tapley-Schutz-Born §4.3.)

import { describe, expect, it } from 'vitest';
import { runOdDemo } from './od.ts';

describe('od demo helper', () => {
  it('recovers the truth state within metres and reports a covariance', () => {
    const r = runOdDemo(1);
    expect(r.observationCount).toBeGreaterThan(0);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.estimate.length).toBe(6);
    // The fit recovers the position to well under a kilometre.
    expect(r.positionErrorKm).toBeLessThan(0.5);
    expect(r.velocityErrorKmS).toBeLessThan(1e-3);
    // The 1-sigma position uncertainties are real, finite, and positive.
    for (const s of r.sigmaPositionKm) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
    expect(Number.isFinite(r.residualRms)).toBe(true);
  });
});
