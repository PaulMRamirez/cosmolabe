// TCA/miss against a closed form, and 2D Pc against the analytic centered-circular
// solution Pc = 1 - exp(-R^2 / 2 sigma^2), plus monotonicity. (STK_PARITY_SPEC §4.8.)

import { describe, it, expect } from 'vitest';
import { closestApproachLinear, collisionProbability2D } from './index.ts';

describe('closestApproachLinear', () => {
  it('finds the perpendicular miss for crossing rectilinear motion', () => {
    // Relative position offset 10 km in y, closing along -x at 7 km/s.
    const ca = closestApproachLinear({ x: 70, y: 10, z: 0 }, { x: -7, y: 0, z: 0 });
    expect(ca.tca).toBeCloseTo(10, 9); // 70 / 7
    expect(ca.missKm).toBeCloseTo(10, 9); // the un-closable y offset
    expect(ca.relSpeedKmS).toBeCloseTo(7, 9);
  });

  it('handles a zero relative velocity', () => {
    const ca = closestApproachLinear({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(ca.tca).toBe(0);
    expect(ca.missKm).toBeCloseTo(5, 9);
  });
});

describe('collisionProbability2D', () => {
  it('matches the analytic centered-circular Pc = 1 - exp(-R^2/2sigma^2)', () => {
    const R = 0.02; // 20 m combined radius
    const sigma = 0.1; // 100 m
    const analytic = 1 - Math.exp(-(R * R) / (2 * sigma * sigma));
    const pc = collisionProbability2D({ radiusKm: R, sigmaXKm: sigma, sigmaYKm: sigma, missXKm: 0, missYKm: 0 });
    expect(pc).toBeCloseTo(analytic, 5);
  });

  it('decreases as the miss distance grows and increases with hard-body radius', () => {
    const base = { radiusKm: 0.02, sigmaXKm: 0.1, sigmaYKm: 0.1, missXKm: 0, missYKm: 0 };
    const far = collisionProbability2D({ ...base, missXKm: 0.3 });
    const near = collisionProbability2D(base);
    expect(far).toBeLessThan(near);
    const bigger = collisionProbability2D({ ...base, radiusKm: 0.05 });
    expect(bigger).toBeGreaterThan(near);
  });

  it('is zero for non-physical inputs', () => {
    expect(collisionProbability2D({ radiusKm: 0, sigmaXKm: 0.1, sigmaYKm: 0.1, missXKm: 0, missYKm: 0 })).toBe(0);
  });
});
