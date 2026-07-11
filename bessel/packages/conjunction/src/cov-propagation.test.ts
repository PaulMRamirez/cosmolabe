// Oracles for STM-based covariance propagation to TCA and the propagated probability of
// collision. The headline oracle is a seeded Monte-Carlo reference: sampling both
// objects' epoch states from their covariances, propagating each nonlinearly to its
// close approach, and counting the fraction that pass within the combined hard-body
// radius must agree with the analytic (STM-linearized, Foster encounter-plane) Pc to
// within the Monte-Carlo standard error. Plus the structural invariants: Phi(t0,t0)=I,
// P stays symmetric positive-definite after propagation, and an isotropic P0 with the
// miss along an in-plane axis reproduces the centered/offset-circular analytic Pc.
// Determinism is mandatory (Math.random and Date.now are forbidden), so the sampler
// uses a fixed-seed PRNG. (STK_PARITY_SPEC §4.8.)

import { describe, it, expect } from 'vitest';
import { integrate, createForceModel, pointMass } from '@bessel/propagator';
import {
  propagateCovarianceToTca,
  combinedEncounterCovariance,
  collisionProbabilityPropagated,
  choleskyLower,
  CovarianceError,
  collisionProbabilityCov,
} from './index.ts';

const MU = 398600.4418; // Earth GM (km^3/s^2)

// ---------------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + Box-Muller standard-normal draws. No Math.random.
// ---------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard-normal generator over a seeded uniform stream (Box-Muller, cached pair). */
function gaussian(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = 2 * uniform() - 1;
      v = 2 * uniform() - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

/** Draw a 6-vector ~ N(0, P) given the lower Cholesky factor L of P (L L^T = P). */
function drawCorrelated(L: Float64Array, n: number, randn: () => number): Float64Array {
  const z = Float64Array.from({ length: n }, () => randn());
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j <= i; j++) acc += L[i * n + j]! * z[j]!;
    out[i] = acc;
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Helpers: build a diagonal 6x6 covariance, propagate a 6-state, find closest miss.
// ---------------------------------------------------------------------------------

function diagCov6(sigmas: readonly number[]): Float64Array {
  const c = new Float64Array(36);
  for (let i = 0; i < 6; i++) c[i * 6 + i] = sigmas[i]! * sigmas[i]!;
  return c;
}

const model = createForceModel([pointMass(MU)]);

const stateRhs = (t: number, y: Float64Array, dy: Float64Array): void => {
  const a = model.acceleration({ et: t, r: [y[0]!, y[1]!, y[2]!], v: [y[3]!, y[4]!, y[5]!] });
  dy[0] = y[3]!;
  dy[1] = y[4]!;
  dy[2] = y[5]!;
  dy[3] = a[0];
  dy[4] = a[1];
  dy[5] = a[2];
};

/** Propagate a 6-state forward to each epoch in `grid` (ascending, >= 0). */
function propGrid(state6: Float64Array, grid: Float64Array): Float64Array[] {
  return integrate(stateRhs, state6, 0, grid);
}

/** Propagate a 6-state backward over `dtSec` (>0): integrate in tau = -t to t = -dtSec. */
function propBack(state6: Float64Array, dtSec: number): Float64Array {
  const buf = new Float64Array(6);
  const revRhs = (tau: number, y: Float64Array, dy: Float64Array): void => {
    stateRhs(-tau, y, buf);
    for (let i = 0; i < 6; i++) dy[i] = -buf[i]!;
  };
  return integrate(revRhs, state6, 0, Float64Array.of(dtSec))[0]!;
}

/**
 * Closest-approach miss (km) of two trajectories sampled on the SAME fine grid, refined
 * by a parabola through the bracketing samples of the discrete minimum (the same exact-
 * for-constant-acceleration model the screener uses).
 */
function closestMiss(a: Float64Array[], b: Float64Array[], grid: Float64Array): number {
  const n = grid.length;
  const d2 = (k: number): number => {
    const dx = a[k]![0]! - b[k]![0]!;
    const dy = a[k]![1]! - b[k]![1]!;
    const dz = a[k]![2]! - b[k]![2]!;
    return dx * dx + dy * dy + dz * dz;
  };
  let kMin = 0;
  let dMin = Infinity;
  for (let k = 0; k < n; k++) {
    const d = d2(k);
    if (d < dMin) {
      dMin = d;
      kMin = k;
    }
  }
  if (kMin > 0 && kMin < n - 1) {
    const xLo = grid[kMin - 1]! - grid[kMin]!;
    const xHi = grid[kMin + 1]! - grid[kMin]!;
    const yLo = d2(kMin - 1);
    const yM = dMin;
    const yHi = d2(kMin + 1);
    const denom = xLo * xHi * (xLo - xHi);
    if (denom !== 0) {
      const A = (xHi * (yLo - yM) - xLo * (yHi - yM)) / denom;
      const B = (xLo * xLo * (yHi - yM) - xHi * xHi * (yLo - yM)) / denom;
      if (A > 0) {
        const xStar = Math.max(xLo, Math.min(xHi, -B / (2 * A)));
        const d2Star = A * xStar * xStar + B * xStar + yM;
        dMin = Math.min(dMin, Math.max(0, d2Star));
      }
    }
  }
  return Math.sqrt(dMin);
}

describe('propagateCovarianceToTca', () => {
  const state6 = Float64Array.of(7000, 0, 0, 0, 7.546, 0); // ~circular LEO, x-axis
  const cov6 = diagCov6([0.05, 0.05, 0.05, 5e-5, 5e-5, 5e-5]);

  it('returns Phi(t0, t0) = identity at TCA = 0 and leaves the covariance unchanged', () => {
    const { phi, cov } = propagateCovarianceToTca(state6, cov6, 0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        expect(phi[i * 6 + j]).toBeCloseTo(i === j ? 1 : 0, 12);
        expect(cov[i * 6 + j]).toBeCloseTo(cov6[i * 6 + j]!, 12);
      }
    }
  });

  it('keeps P(tca) symmetric positive-definite after propagation', () => {
    const { cov } = propagateCovarianceToTca(state6, cov6, 600);
    // Symmetric within a tight tolerance.
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        expect(cov[i * 6 + j]).toBeCloseTo(cov[j * 6 + i]!, 9);
      }
    }
    // Positive-definite: choleskyLower succeeds only on an SPD matrix.
    expect(() => choleskyLower(cov, 6)).not.toThrow();
  });

  it('propagates backward in time (negative TCA) to an SPD covariance', () => {
    const fwd = propagateCovarianceToTca(state6, cov6, -600);
    expect(() => choleskyLower(fwd.cov, 6)).not.toThrow();
  });

  it('throws a located CovarianceError on a non-positive-definite covariance', () => {
    const bad = diagCov6([0.05, 0.05, 0.05, 5e-5, 5e-5, 5e-5]);
    bad[0] = -1; // negative variance: not positive-definite
    expect(() => propagateCovarianceToTca(state6, bad, 100)).toThrow(CovarianceError);
  });

  it('throws on a malformed (wrong-length) covariance', () => {
    expect(() => propagateCovarianceToTca(state6, new Float64Array(35), 100)).toThrow(CovarianceError);
  });
});

describe('combinedEncounterCovariance + analytic Pc reductions', () => {
  it('reproduces the centered-circular analytic Pc for an isotropic in-plane covariance', () => {
    // A head-on encounter: both on the x-axis, equal and opposite small along-track
    // velocities so the relative velocity at TCA is along y (defines the encounter
    // plane), and a zero nominal miss. With isotropic position covariance the in-plane
    // 2x2 is sigma^2 I and the centered Pc is 1 - exp(-R^2 / 2 sigma^2).
    const sigma = 0.1; // km, per-axis position 1-sigma
    const primary = Float64Array.of(7000, 0, 0, 0, 7.5, 0);
    const secondary = Float64Array.of(7000, 0, 0, 0, -7.5, 0); // crosses at the same point at t=0
    const cov = diagCov6([sigma, sigma, sigma, 1e-9, 1e-9, 1e-9]);
    const R = 0.02; // 20 m combined hard-body radius

    const enc = combinedEncounterCovariance(primary, cov, secondary, cov, 0, MU);
    // Combined isotropic position covariance is (2 sigma^2) I in-plane.
    const combinedSigma2 = 2 * sigma * sigma;
    expect(enc.cov2.cxx).toBeCloseTo(combinedSigma2, 6);
    expect(enc.cov2.cyy).toBeCloseTo(combinedSigma2, 6);
    expect(enc.cov2.cxy).toBeCloseTo(0, 6);
    expect(enc.missKm).toBeCloseTo(0, 6);

    const pc = collisionProbabilityCov({ radiusKm: R, missXKm: 0, missYKm: 0, cov: enc.cov2 });
    const analytic = 1 - Math.exp(-(R * R) / (2 * combinedSigma2));
    expect(pc).toBeCloseTo(analytic, 4);
  });
});

describe('Monte-Carlo validation of the propagated Pc', () => {
  // A realistic short-arc conjunction: two LEO objects that close to a small miss about
  // ~9 minutes after epoch. Each carries a diagonal epoch covariance. The analytic Pc
  // propagates the covariances by the STM to TCA, combines them in the encounter plane,
  // and integrates Foster's Pc. The Monte-Carlo reference samples both epoch states from
  // their covariances, propagates each nonlinearly, and counts the close-approach
  // fraction inside the combined hard-body radius.
  it('matches a seeded Monte-Carlo close-approach estimate within the MC standard error', () => {
    // Construct a genuine near-miss with a controlled, sub-km nominal miss so the
    // probability is appreciable (a few percent, where Monte-Carlo at N samples has the
    // statistical power to resolve it). The primary rides a ~circular equatorial orbit.
    // Pick the TCA mid-arc, read the primary state there, then BUILD the secondary's TCA
    // state as the primary position plus a small in-plane (cross-track) offset with a
    // velocity rotated by a crossing angle (so the relative velocity is non-degenerate),
    // and back-propagate it to epoch. The two epochs are then a real short-arc
    // conjunction whose nominal miss is exactly the offset we chose.
    const r = 7000;
    const vc = Math.sqrt(MU / r);
    const primary = Float64Array.of(r, 0, 0, 0, vc, 0);
    const tcaSec = 1500; // ~mid-arc, a genuine downstream propagation
    const pT = propGrid(primary, Float64Array.of(tcaSec))[0]!; // primary state at TCA
    const posT: [number, number, number] = [pT[0]!, pT[1]!, pT[2]!];
    const velT: [number, number, number] = [pT[3]!, pT[4]!, pT[5]!];
    // Offset the secondary by a sub-km out-of-plane (z) miss at TCA, and incline its
    // velocity by a finite crossing angle so the relative velocity at TCA is on the order
    // of 1 km/s (a real fly-through, not a co-orbiting pair). Back-propagating that TCA
    // state to epoch yields the secondary's initial conditions; the nominal miss is then
    // exactly the chosen offset.
    const missOffsetKm = 0.3; // nominal miss along z (km)
    const crossAngle = 0.2; // rad (~11 deg) crossing angle -> relative speed ~ 1.5 km/s
    const speed = Math.hypot(velT[0], velT[1], velT[2]);
    const vhat: [number, number, number] = [velT[0] / speed, velT[1] / speed, velT[2] / speed];
    // Rotate vhat toward +z by `crossAngle`, keeping the in-plane direction and adding a
    // z component, so the two velocities differ by a finite angle.
    const secVelT: [number, number, number] = [
      speed * vhat[0] * Math.cos(crossAngle),
      speed * vhat[1] * Math.cos(crossAngle),
      speed * Math.sin(crossAngle),
    ];
    const secStateT = Float64Array.of(
      posT[0],
      posT[1],
      posT[2] + missOffsetKm,
      secVelT[0],
      secVelT[1],
      secVelT[2],
    );
    const secondary = propBack(secStateT, tcaSec); // secondary epoch state

    // Diagonal epoch covariances (km, km/s). Position 1-sigma 0.2 km, velocity 0.3 m/s.
    // Propagated 1500 s, the velocity uncertainty grows the in-plane position sigma to
    // ~1 km, so the encounter is uncertainty-dominated and the Pc is a resolvable few
    // percent (the regime where Foster's integral and the Monte-Carlo agree).
    const sigPos = 0.2;
    const sigVel = 3e-4;
    const covP = diagCov6([sigPos, sigPos, sigPos, sigVel, sigVel, sigVel]);
    const covS = diagCov6([sigPos, sigPos, sigPos, sigVel, sigVel, sigVel]);
    const R = 0.25; // 250 m combined hard-body radius

    // Analytic propagated Pc.
    const analyticPc = collisionProbabilityPropagated(primary, covP, secondary, covS, tcaSec, R, MU, 360);
    expect(analyticPc).toBeGreaterThan(0);
    expect(analyticPc).toBeLessThan(1);

    // Monte-Carlo: sample both epoch states from their covariances and count hits.
    const Lp = choleskyLower(covP, 6);
    const Ls = choleskyLower(covS, 6);
    const uniform = mulberry32(0x9e3779b9);
    const randn = gaussian(uniform);
    const N = 6000;
    // A local fine grid bracketing the nominal TCA so the close-approach miss is resolved.
    const half = 60; // s on each side
    const m = 121;
    const mcGrid = Float64Array.from({ length: m }, (_, i) => (tcaSec - half) + (2 * half * i) / (m - 1));

    let hits = 0;
    for (let s = 0; s < N; s++) {
      const dp = drawCorrelated(Lp, 6, randn);
      const ds = drawCorrelated(Ls, 6, randn);
      const ps = Float64Array.from({ length: 6 }, (_, i) => primary[i]! + dp[i]!);
      const ss = Float64Array.from({ length: 6 }, (_, i) => secondary[i]! + ds[i]!);
      const pa = propGrid(ps, mcGrid);
      const sb = propGrid(ss, mcGrid);
      if (closestMiss(pa, sb, mcGrid) <= R) hits += 1;
    }
    const mcPc = hits / N;
    // Binomial standard error of the MC estimate; assert agreement within ~3 sigma (plus a
    // small floor for the linearization/quadrature bias), a robust statistical bound.
    const se = Math.sqrt(Math.max(mcPc * (1 - mcPc), 1 / N) / N);
    const tol = 3 * se + 0.1 * analyticPc;
    expect(Math.abs(analyticPc - mcPc)).toBeLessThanOrEqual(tol);
    // Sanity: both estimates are in a believable band, not degenerate.
    expect(mcPc).toBeGreaterThan(0);
  });
});
