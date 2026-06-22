import { describe, it, expect } from 'vitest';
import { decideSlewFeasibility, SlewFeasibilityError, type SlewWindowPair } from './slew-feasibility.ts';
import { eigenAxisSlew, type Quaternion } from '@bessel/attitude';

// The slew-fits decision is pure (analysis-UX Phase 2): eigenAxisSlew duration vs the inter-window
// gap. These tests pin the fits/does-not-fit verdict, the gap arithmetic, and the fail-loud paths.

const identity: Quaternion = [1, 0, 0, 0];
// A 90 deg rotation about +X: [cos45, sin45, 0, 0].
const ninetyAboutX: Quaternion = [Math.SQRT1_2, Math.SQRT1_2, 0, 0];

const dynamics = { maxRateDegPerSec: 1, maxAccelDegPerSec2: 0.25 };

describe('decideSlewFeasibility', () => {
  it('reports the gap as the second window start minus the first window end', () => {
    const pair: SlewWindowPair = {
      firstWindow: [0, 100],
      secondWindow: [400, 500],
      fromQuat: identity,
      toQuat: identity,
    };
    const v = decideSlewFeasibility(pair, dynamics);
    expect(v.gapSec).toBe(300);
    // Same attitude: zero slew angle/duration, so it fits with all the gap as slack.
    expect(v.slewAngleDeg).toBeCloseTo(0, 9);
    expect(v.slewDurationSec).toBeCloseTo(0, 9);
    expect(v.fits).toBe(true);
    expect(v.slackSec).toBeCloseTo(300, 9);
  });

  it('fits when the slew duration is under the gap, and reports the right angle', () => {
    // 90 deg slew. Duration from eigenAxisSlew at the same dynamics; give a generous gap.
    const slew = eigenAxisSlew(identity, ninetyAboutX, dynamics.maxRateDegPerSec / (180 / Math.PI), dynamics.maxAccelDegPerSec2 / (180 / Math.PI));
    const pair: SlewWindowPair = {
      firstWindow: [0, 100],
      secondWindow: [100 + slew.duration + 50, 200 + slew.duration + 50],
      fromQuat: identity,
      toQuat: ninetyAboutX,
    };
    const v = decideSlewFeasibility(pair, dynamics);
    expect(v.slewAngleDeg).toBeCloseTo(90, 4);
    expect(v.slewDurationSec).toBeCloseTo(slew.duration, 6);
    expect(v.fits).toBe(true);
    expect(v.slackSec).toBeCloseTo(50, 4);
  });

  it('does NOT fit when the gap is shorter than the slew duration', () => {
    const pair: SlewWindowPair = {
      firstWindow: [0, 100],
      secondWindow: [101, 200], // a 1 s gap, far too short for a 90 deg slew at 1 deg/s
      fromQuat: identity,
      toQuat: ninetyAboutX,
    };
    const v = decideSlewFeasibility(pair, dynamics);
    expect(v.fits).toBe(false);
    expect(v.slackSec).toBeLessThan(0);
  });

  it('fails loud on a non-positive gap (overlapping or out-of-order windows)', () => {
    const overlap: SlewWindowPair = {
      firstWindow: [0, 200],
      secondWindow: [100, 300],
      fromQuat: identity,
      toQuat: identity,
    };
    expect(() => decideSlewFeasibility(overlap, dynamics)).toThrow(SlewFeasibilityError);
  });

  it('fails loud on a non-positive rate or acceleration', () => {
    const pair: SlewWindowPair = {
      firstWindow: [0, 100],
      secondWindow: [400, 500],
      fromQuat: identity,
      toQuat: ninetyAboutX,
    };
    expect(() => decideSlewFeasibility(pair, { maxRateDegPerSec: 0, maxAccelDegPerSec2: 0.25 })).toThrow(SlewFeasibilityError);
    expect(() => decideSlewFeasibility(pair, { maxRateDegPerSec: 1, maxAccelDegPerSec2: 0 })).toThrow(SlewFeasibilityError);
  });
});
