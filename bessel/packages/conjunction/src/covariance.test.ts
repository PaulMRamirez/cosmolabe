// Oracles for the full-covariance encounter-plane Pc, the B-plane construction and
// 3x3 -> 2x2 projection, and the Alfano/Frisbee maximum Pc. References:
//  - Foster's method (axis-aligned) reduction and the analytic centered-circular
//    solution Pc = 1 - exp(-R^2 / 2 sigma^2).
//  - Alfano 2005, "Relating Position Uncertainty to the Maximum Probability of
//    Collision" (AAS 05-128): Pc_max = (R/m) sqrt(2/pi) exp(-1/2).
// (STK_PARITY_SPEC §4.8.)

import { describe, it, expect } from 'vitest';
import {
  collisionProbability2D,
  collisionProbabilityCov,
  encounterPlane,
  projectCovarianceToEncounterPlane,
  maxCollisionProbability,
  CovarianceError,
  type Cov2x2,
  type Vec3,
} from './index.ts';

describe('collisionProbabilityCov', () => {
  it('reduces to the axis-aligned collisionProbability2D when cxy = 0', () => {
    const cases = [
      { radiusKm: 0.02, sx: 0.1, sy: 0.1, mx: 0, my: 0 },
      { radiusKm: 0.03, sx: 0.15, sy: 0.08, mx: 0.2, my: 0 },
      { radiusKm: 0.05, sx: 0.2, sy: 0.3, mx: 0.1, my: -0.25 },
      { radiusKm: 0.04, sx: 0.12, sy: 0.5, mx: -0.4, my: 0.6 },
    ];
    for (const c of cases) {
      const axis = collisionProbability2D({
        radiusKm: c.radiusKm,
        sigmaXKm: c.sx,
        sigmaYKm: c.sy,
        missXKm: c.mx,
        missYKm: c.my,
      });
      const cov = collisionProbabilityCov({
        radiusKm: c.radiusKm,
        missXKm: c.mx,
        missYKm: c.my,
        cov: { cxx: c.sx * c.sx, cxy: 0, cyy: c.sy * c.sy },
      });
      expect(cov).toBeCloseTo(axis, 12);
    }
  });

  it('matches the analytic centered-circular Pc = 1 - exp(-R^2/2sigma^2)', () => {
    const R = 0.02;
    const sigma = 0.1;
    const analytic = 1 - Math.exp(-(R * R) / (2 * sigma * sigma));
    const pc = collisionProbabilityCov({
      radiusKm: R,
      missXKm: 0,
      missYKm: 0,
      cov: { cxx: sigma * sigma, cxy: 0, cyy: sigma * sigma },
    });
    expect(pc).toBeCloseTo(analytic, 5);
  });

  it('agrees with the diagonal integrator after rotating into principal axes', () => {
    // Build a rotated covariance from principal variances l1, l2 at angle phi, with a
    // miss vector in world coords; rotate the miss into principal axes and use the
    // diagonal path. The two computations must agree.
    const phi = 0.7; // rad
    const l1 = 0.25; // variance along principal axis 1 (km^2)
    const l2 = 0.04; // variance along principal axis 2 (km^2)
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    // C = R diag(l1,l2) R^T with R = [[c,-s],[s,c]].
    const cxx = c * c * l1 + s * s * l2;
    const cyy = s * s * l1 + c * c * l2;
    const cxy = c * s * (l1 - l2);
    const mx = 0.3;
    const my = -0.15;
    const R = 0.05;

    const full = collisionProbabilityCov({ radiusKm: R, missXKm: mx, missYKm: my, cov: { cxx, cxy, cyy } });

    // Rotate miss into principal axes: m' = R^T m.
    const mp1 = c * mx + s * my;
    const mp2 = -s * mx + c * my;
    const diag = collisionProbabilityCov({
      radiusKm: R,
      missXKm: mp1,
      missYKm: mp2,
      cov: { cxx: l1, cxy: 0, cyy: l2 },
    });
    expect(full).toBeCloseTo(diag, 9);
  });

  it('throws on a non-positive-definite covariance', () => {
    expect(() =>
      collisionProbabilityCov({ radiusKm: 0.02, missXKm: 0, missYKm: 0, cov: { cxx: 0.1, cxy: 0.5, cyy: 0.1 } }),
    ).toThrow(CovarianceError);
    expect(() =>
      collisionProbabilityCov({ radiusKm: 0.02, missXKm: 0, missYKm: 0, cov: { cxx: -0.1, cxy: 0, cyy: 0.1 } }),
    ).toThrow(CovarianceError);
  });

  it('returns 0 for a non-physical radius', () => {
    expect(collisionProbabilityCov({ radiusKm: 0, missXKm: 0, missYKm: 0, cov: { cxx: 0.01, cxy: 0, cyy: 0.01 } })).toBe(0);
  });
});

describe('encounterPlane', () => {
  const orthonormal = (frame: { u: Vec3; v: Vec3; n: Vec3 }): void => {
    const d = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(d(frame.u, frame.u)).toBeCloseTo(1, 12);
    expect(d(frame.v, frame.v)).toBeCloseTo(1, 12);
    expect(d(frame.n, frame.n)).toBeCloseTo(1, 12);
    expect(d(frame.u, frame.v)).toBeCloseTo(0, 12);
    expect(d(frame.u, frame.n)).toBeCloseTo(0, 12);
    expect(d(frame.v, frame.n)).toBeCloseTo(0, 12);
  };

  it('builds an orthonormal triad with u, v orthogonal to relVel', () => {
    for (const rv of [
      { x: 7, y: 0, z: 0 },
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: -5 },
      { x: -3, y: 4, z: 0 },
    ] satisfies Vec3[]) {
      const f = encounterPlane(rv);
      orthonormal(f);
      // n is the relVel unit.
      const speed = Math.hypot(rv.x, rv.y, rv.z);
      expect(f.n.x).toBeCloseTo(rv.x / speed, 12);
      expect(f.n.y).toBeCloseTo(rv.y / speed, 12);
      expect(f.n.z).toBeCloseTo(rv.z / speed, 12);
    }
  });

  it('throws on a zero relative velocity', () => {
    expect(() => encounterPlane({ x: 0, y: 0, z: 0 })).toThrow(CovarianceError);
  });
});

describe('projectCovarianceToEncounterPlane', () => {
  it('projects an isotropic 3x3 to {sigma^2, 0, sigma^2}', () => {
    const sigma2 = 0.09;
    const iso = [sigma2, 0, 0, 0, sigma2, 0, 0, 0, sigma2];
    const frame = encounterPlane({ x: 1, y: 2, z: 3 });
    const c2 = projectCovarianceToEncounterPlane(iso, frame);
    expect(c2.cxx).toBeCloseTo(sigma2, 12);
    expect(c2.cyy).toBeCloseTo(sigma2, 12);
    expect(c2.cxy).toBeCloseTo(0, 12);
  });

  it('preserves trace and stays positive-definite for an anisotropic covariance', () => {
    // Diagonal anisotropic covariance projected onto the plane normal to x: the plane
    // is spanned by directions in y,z, so the in-plane trace equals cyy + czz.
    const cov = [0.5, 0, 0, 0, 0.2, 0, 0, 0, 0.3];
    const frame = encounterPlane({ x: 9, y: 0, z: 0 }); // n = +x; plane is y,z
    const c2: Cov2x2 = projectCovarianceToEncounterPlane(cov, frame);
    const trace = c2.cxx + c2.cyy;
    expect(trace).toBeCloseTo(0.2 + 0.3, 10);
    const det = c2.cxx * c2.cyy - c2.cxy * c2.cxy;
    expect(det).toBeGreaterThan(0);
    expect(c2.cxx).toBeGreaterThan(0);
    expect(c2.cyy).toBeGreaterThan(0);
  });

  it('throws on a malformed 3x3 covariance', () => {
    const frame = encounterPlane({ x: 1, y: 0, z: 0 });
    expect(() => projectCovarianceToEncounterPlane([1, 0, 0, 0, 1, 0], frame)).toThrow(CovarianceError);
    // Non-symmetric.
    expect(() => projectCovarianceToEncounterPlane([1, 0.5, 0, 0, 1, 0, 0, 0, 1], frame)).toThrow(CovarianceError);
  });
});

describe('maxCollisionProbability (Alfano/Frisbee)', () => {
  it('matches the Alfano closed form (R/m) sqrt(2/pi) exp(-1/2)', () => {
    // Alfano 2005 maximum-Pc for a 5 m combined hard-body radius at 1 km miss.
    const R = 0.005;
    const m = 1;
    const ref = (R / m) * Math.sqrt(2 / Math.PI) * Math.exp(-0.5);
    expect(maxCollisionProbability(m, R)).toBeCloseTo(ref, 12);
    // Numeric reference value: 0.005 * 0.483941449... = 2.41970...e-3.
    expect(maxCollisionProbability(m, R)).toBeCloseTo(2.4197072451914337e-3, 12);
  });

  it('upper-bounds collisionProbabilityCov for any covariance (small hard-body regime)', () => {
    // Spot-check several covariances (circular, elongated, rotated) at R << m.
    const m = 2;
    const R = 0.02; // R/m = 0.01, the regime where max-Pc applies
    const bound = maxCollisionProbability(m, R);
    const covs: Cov2x2[] = [
      { cxx: 0.04, cxy: 0, cyy: 0.04 }, // circular
      { cxx: 1.0, cxy: 0, cyy: 0.01 }, // elongated along miss
      { cxx: 0.01, cxy: 0, cyy: 1.0 }, // elongated across miss
      { cxx: 0.5, cxy: 0.3, cyy: 0.4 }, // rotated / cross-correlated
      { cxx: 4.0, cxy: -1.2, cyy: 0.6 },
    ];
    for (const cov of covs) {
      const pc = collisionProbabilityCov({ radiusKm: R, missXKm: m, missYKm: 0, cov });
      expect(pc).toBeLessThanOrEqual(bound + 1e-12);
    }
  });

  it('throws on a non-positive radius and returns 1 for a zero miss', () => {
    expect(() => maxCollisionProbability(1, 0)).toThrow(CovarianceError);
    expect(() => maxCollisionProbability(1, -0.01)).toThrow(CovarianceError);
    expect(maxCollisionProbability(0, 0.01)).toBe(1);
  });
});
