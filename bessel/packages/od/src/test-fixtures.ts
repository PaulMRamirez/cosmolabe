// Shared test scaffolding for orbit-determination tests: a fixed Earth force model
// (point mass + J2), a truth state, a propagator that samples the truth trajectory, a
// deterministic LCG (since Math.random is not a stable oracle), and helpers to synthesize
// range / range-rate / angle measurements from a known observer. Not part of the public
// API (no re-export from index.ts); test-only.

import { createForceModel, pointMass, zonalHarmonics, type ForceModel } from '@bessel/propagator';
import { propagateArc } from './propagate.ts';
import type { AnglesMeasurement, Measurement, ObserverPosition } from './types.ts';

export const EARTH = { gm: 398600.4418, re: 6378.137, j2: 1.08262668e-3 };

/** Point-mass + J2 Earth force model, the dynamics every OD test shares. */
export function earthForceModel(): ForceModel {
  return createForceModel([
    pointMass(EARTH.gm),
    zonalHarmonics({ gm: EARTH.gm, re: EARTH.re }, { j2: EARTH.j2 }),
  ]);
}

/** A representative LEO truth state at ET 0 (km, km/s): ~700 km altitude, inclined. */
export function truthState(): Float64Array {
  const a = EARTH.re + 700; // semi-major-ish radius
  const v = Math.sqrt(EARTH.gm / a);
  // Position on the equator, velocity inclined ~45 deg out of the equatorial plane.
  const inc = (45 * Math.PI) / 180;
  return Float64Array.of(a, 0, 0, 0, v * Math.cos(inc), v * Math.sin(inc));
}

/** Sample the truth trajectory: state at each epoch, integrated from `t0`. */
export function sampleTruth(state0: Float64Array, t0: number, epochs: readonly number[], fm: ForceModel): Float64Array[] {
  const arc = propagateArc(state0, t0, epochs, fm);
  return epochs.map((e) => arc.stateAt(e));
}

/** A small deterministic linear congruential generator giving uniforms in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A standard-normal sample from two uniforms (Box-Muller), driven by an LCG. */
export function gaussian(u: () => number): () => number {
  return () => {
    const u1 = Math.max(u(), 1e-12);
    const u2 = u();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

/** Build a ground observer in ECI: a fixed inertial position (km), simplification for tests. */
export function fixedObserver(): ObserverPosition {
  // A point on the Earth surface-ish, offset from the geocenter, treated as inertial.
  return [EARTH.re * 0.6, EARTH.re * 0.6, EARTH.re * 0.4];
}

/** Range from observer to a truth 6-state (km). */
export function makeRange(state6: ArrayLike<number>, observer: ObserverPosition, epoch: number, sigma: number, noise = 0): Measurement {
  const dx = state6[0]! - observer[0];
  const dy = state6[1]! - observer[1];
  const dz = state6[2]! - observer[2];
  const range = Math.hypot(dx, dy, dz);
  return { kind: 'range', epoch, observer, sigma, value: range + noise };
}

/** Range-rate from observer to a truth 6-state (km/s); observer inertial. */
export function makeRangeRate(state6: ArrayLike<number>, observer: ObserverPosition, epoch: number, sigma: number, noise = 0): Measurement {
  const dx = state6[0]! - observer[0];
  const dy = state6[1]! - observer[1];
  const dz = state6[2]! - observer[2];
  const range = Math.hypot(dx, dy, dz);
  const rdot = (dx * state6[3]! + dy * state6[4]! + dz * state6[5]!) / range;
  return { kind: 'rangeRate', epoch, observer, sigma, value: rdot + noise };
}

/** Right ascension / declination from observer to a truth 6-state (rad). */
export function makeRaDec(
  state6: ArrayLike<number>,
  observer: ObserverPosition,
  epoch: number,
  sigma: readonly [number, number],
  noise: readonly [number, number] = [0, 0],
): AnglesMeasurement {
  const dx = state6[0]! - observer[0];
  const dy = state6[1]! - observer[1];
  const dz = state6[2]! - observer[2];
  const range = Math.hypot(dx, dy, dz);
  const ra = Math.atan2(dy, dx);
  const dec = Math.asin(dz / range);
  return { kind: 'angles', frame: 'radec', epoch, observer, sigma, value: [ra + noise[0], dec + noise[1]] };
}
