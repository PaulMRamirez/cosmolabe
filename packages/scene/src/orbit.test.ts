// Planet orbit paths: orbitEllipse turns a state vector into a closed orbit
// polyline. A circular state yields a circle; an elliptical state yields the
// right size; a hyperbolic state yields nothing to draw.

import { describe, it, expect } from 'vitest';
import { orbitEllipse } from './orbit.ts';

const MU = 1.0; // unit gravity for clean numbers

describe('orbitEllipse', () => {
  it('returns a circle of radius r for a circular state', () => {
    // Circular orbit at r=1: speed = sqrt(mu/r) = 1, perpendicular to r.
    const pts = orbitEllipse([1, 0, 0], [0, 1, 0], MU, 64);
    expect(pts.length).toBe(65);
    for (const p of pts) {
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 3);
    }
    // Closed: first and last coincide (within floating-point epsilon).
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
    expect(a[2]).toBeCloseTo(b[2], 9);
  });

  it('lies in the orbital plane (z = 0 for an equatorial state)', () => {
    const pts = orbitEllipse([2, 0, 0], [0, Math.sqrt(MU / 2), 0], MU, 32);
    for (const p of pts) expect(Math.abs(p[2])).toBeLessThan(1e-9);
  });

  it('produces an eccentric ellipse for a sub-circular speed (start is apoapsis)', () => {
    // Sub-circular speed at r=1: the start is the farthest point (apoapsis = 1)
    // and periapsis is inside, so the orbit is a non-circular ellipse.
    const pts = orbitEllipse([1, 0, 0], [0, 0.9, 0], MU, 256);
    const radii = pts.map((p) => Math.hypot(p[0], p[1], p[2]));
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    expect(min).toBeLessThan(0.99); // periapsis inside the start radius
    expect(max).toBeLessThanOrEqual(1.001); // the start (r=1) is the apoapsis
    expect(max - min).toBeGreaterThan(0.05); // eccentric, not a circle
  });

  it('returns nothing for a hyperbolic (escape) state', () => {
    // Speed well above escape (sqrt(2 mu/r) at r=1 is ~1.414).
    expect(orbitEllipse([1, 0, 0], [0, 2, 0], MU)).toEqual([]);
  });

  it('returns nothing for a degenerate state', () => {
    expect(orbitEllipse([0, 0, 0], [0, 1, 0], MU)).toEqual([]);
    expect(orbitEllipse([1, 0, 0], [1, 0, 0], MU)).toEqual([]); // radial
  });
});
