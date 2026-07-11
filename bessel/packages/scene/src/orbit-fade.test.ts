import { describe, expect, it } from 'vitest';

import { orbitFade } from './three-scene';

// ratio = orbit radius / camera distance to its center. Rings fade out at both
// ends of the band so they neither clutter (too small) nor dominate (too large).
describe('orbitFade', () => {
  it('hides clutter-sized rings', () => {
    expect(orbitFade(0.01)).toBe(0);
  });

  it('hides rings that would dominate the frame', () => {
    expect(orbitFade(2)).toBe(0);
  });

  it('shows rings that span a comfortable fraction of the frame', () => {
    expect(orbitFade(0.2)).toBe(1);
  });

  it('ramps monotonically through the fade-in edge', () => {
    expect(orbitFade(0.03)).toBeGreaterThan(orbitFade(0.025));
    expect(orbitFade(0.05)).toBeGreaterThan(orbitFade(0.03));
  });

  it('ramps monotonically through the fade-out edge', () => {
    expect(orbitFade(0.6)).toBeGreaterThan(orbitFade(1.2));
    expect(orbitFade(1.2)).toBeGreaterThan(orbitFade(1.5));
  });
});
