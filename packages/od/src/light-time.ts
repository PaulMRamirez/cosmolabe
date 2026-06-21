// Light-time-corrected measurement prediction. The plain `predict` (measurements.ts) takes
// instantaneous geometry: the observable from the target state at the reception epoch. A
// real range/Doppler/angle observable is formed from the photon that LEFT the target one
// light-time tau EARLIER and arrived at the observer now, so the predicted observable must
// use the RETARDED target state r_sat(t_rx - tau), with tau solved from the implicit
// down-leg equation
//
//   tau = |r_sat(t_rx - tau) - r_obs(t_rx)| / c.
//
// This is the standard "down-leg" / reception light-time solution (Moyer, Formulation for
// Observed and Computed Values of Deep Space Network Data Types; Vallado §5.3 aberration).
// We solve tau by fixed-point iteration (it converges geometrically since |d tau / d r| is
// rangeRate/c << 1), evaluate the chosen observable on the retarded state, and refer the
// analytic partial back to the reception epoch through the arc STM Phi(t_rx - tau, t_rx)
// plus the light-time Jacobian factor 1 / (1 - rangeRate/c) that accounts for tau itself
// depending on the state. (Tapley-Schutz-Born §3.4 for the partials.)

import { MeasurementError } from './errors.ts';
import { predict, type Prediction } from './measurements.ts';
import type { Arc } from './propagate.ts';
import { measurementSize, type Measurement } from './types.ts';

/** Speed of light in vacuum, km/s (IAU/NAIF clight). */
export const SPEED_OF_LIGHT_KM_S = 299792.458;

/** Options for a light-time-corrected prediction. */
export interface LightTimeOptions {
  /** Fixed-point tolerance on tau (s); default 1e-12. */
  readonly tolTau?: number;
  /** Maximum fixed-point iterations; default 50. */
  readonly maxIterations?: number;
}

/** A light-time-corrected prediction: the observable plus the converged one-way light time. */
export interface LightTimePrediction extends Prediction {
  /** The converged one-way (down-leg) light time tau (s). */
  readonly lightTime: number;
  /** The retarded transmit epoch t_rx - tau (ET s). */
  readonly transmitEpoch: number;
}

/**
 * Predict the observable for `m` (whose `epoch` is the reception time t_rx) with the down-leg
 * light-time correction, using `arc` to sample the retarded target state and the STM that maps
 * a retarded-epoch perturbation back to the reception epoch. The observer position rides on the
 * measurement and is taken at the reception epoch. Returns the observable, its (size x 6)
 * Jacobian with respect to the state at the RECEPTION epoch, and the converged light time.
 *
 * The Jacobian uses the chain rule dh/dx_rx = (dh/dx_tx) * Phi(t_tx, t_rx) * L, where L is the
 * scalar light-time correction factor 1 / (1 - (rho.v_tx)/(|rho| c)) that scales the position
 * sensitivity to absorb the implicit dependence of tau on the state. For the down-leg solution
 * this factor multiplies the retarded geometry partial.
 */
export function predictLightTime(m: Measurement, arc: Arc, options: LightTimeOptions = {}): LightTimePrediction {
  const tRx = m.epoch;
  const c = SPEED_OF_LIGHT_KM_S;
  const tol = options.tolTau ?? 1e-12;
  const maxIter = options.maxIterations ?? 50;

  // Fixed-point solve of the down-leg light-time equation.
  const tau = solveLightTime(m, arc, tRx, c, tol, maxIter);
  const tTx = tRx - tau;
  const retarded = arc.stateAt(tTx);

  // Observable and its partial with respect to the retarded (transmit-epoch) state.
  const predTx = predict(m, retarded);

  // Light-time Jacobian factor L = 1 / (1 - rhoHat.v_tx / c): the retarded position depends on
  // tau, which depends on the state, so the position columns pick up this scalar inflation.
  const rho: [number, number, number] = [retarded[0]! - m.observer[0], retarded[1]! - m.observer[1], retarded[2]! - m.observer[2]];
  const range = Math.hypot(rho[0], rho[1], rho[2]);
  if (range === 0) throw new MeasurementError('predictLightTime: observer coincides with retarded target (zero range)');
  const rangeRate = (rho[0] * retarded[3]! + rho[1] * retarded[4]! + rho[2] * retarded[5]!) / range;
  const denom = 1 - rangeRate / c;
  if (Math.abs(denom) < 1e-12) throw new MeasurementError('predictLightTime: light-time Jacobian singular (range-rate ~ c)');
  const ltFactor = 1 / denom;

  // Map the retarded-state partial back to the reception epoch via Phi(t_tx, t_rx), then apply
  // the light-time factor. dh/dx_rx = (dh/dx_tx . ltFactor on the geometry) * Phi(t_tx, t_rx).
  const phi = arc.stmAt(tTx); // Phi(t_tx, t0); see note in mapPartialToReception for the rebasing.
  const jac = mapPartialToReception(predTx.jac, measurementSize(m), phi, arc, tRx, tTx, ltFactor);

  return { value: predTx.value, jac, lightTime: tau, transmitEpoch: tTx };
}

/** Fixed-point iteration tau <- |r_sat(t_rx - tau) - r_obs| / c. */
function solveLightTime(m: Measurement, arc: Arc, tRx: number, c: number, tol: number, maxIter: number): number {
  let tau = 0;
  for (let i = 0; i < maxIter; i++) {
    const st = arc.stateAt(tRx - tau);
    const dx = st[0]! - m.observer[0];
    const dy = st[1]! - m.observer[1];
    const dz = st[2]! - m.observer[2];
    const next = Math.hypot(dx, dy, dz) / c;
    if (Math.abs(next - tau) <= tol) return next;
    tau = next;
  }
  throw new MeasurementError(`predictLightTime: light-time iteration did not converge in ${maxIter} steps`);
}

/**
 * Map a (size x 6) partial taken at the transmit epoch back to the reception epoch. The arc STM
 * sampler returns Phi(et, t0) for the arc base epoch t0, so Phi(t_tx, t_rx) = Phi(t_tx, t0) *
 * Phi(t_rx, t0)^-1. We avoid an explicit inverse by composing the two STMs the arc already
 * holds: dh/dx_rx = dhTx * Phi(t_tx, t0) * Phi(t_rx, t0)^-1, applying the light-time factor to
 * the position block of dhTx first. For the common batch use t0 == t_rx (the solve epoch is the
 * reception epoch of the earliest measurement is not generally true), so we compute the inverse
 * via the 6x6 STM the arc provides.
 */
function mapPartialToReception(
  jacTx: Float64Array,
  size: number,
  phiTx: Float64Array,
  arc: Arc,
  tRx: number,
  _tTx: number,
  ltFactor: number,
): Float64Array {
  // Apply the light-time factor to the position columns of the transmit-epoch partial. The
  // angle/range observables read position; range-rate reads position and velocity. The factor
  // scales the geometric (position) sensitivity that the retarded-tau correction inflates.
  const dhTx = new Float64Array(jacTx.length);
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < 3; k++) dhTx[i * 6 + k] = jacTx[i * 6 + k]! * ltFactor;
    for (let k = 3; k < 6; k++) dhTx[i * 6 + k] = jacTx[i * 6 + k]!;
  }
  // Compose Phi(t_tx, t_rx) = Phi(t_tx, t0) * Phi(t_rx, t0)^-1. Phi(t_rx, t0)^-1 depends only on
  // the arc and the reception epoch, not on the (per-component) partial being rebased, so cache
  // it by (arc, tRx) to avoid re-inverting the 6x6 on every call.
  const phiRxInv = receptionStmInverse(arc, tRx);
  const phiTxRx = matmul6(phiTx, phiRxInv);
  // dh/dx_rx = dhTx * Phi(t_tx, t_rx).
  const out = new Float64Array(size * 6);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < 6; j++) {
      let acc = 0;
      for (let k = 0; k < 6; k++) acc += dhTx[i * 6 + k]! * phiTxRx[k * 6 + j]!;
      out[i * 6 + j] = acc;
    }
  }
  return out;
}

/**
 * Cache of Phi(t_rx, t0)^-1 per arc. The inverse depends only on the arc and the reception
 * epoch, so the same arc reused across many measurements at the same t_rx (the common batch
 * pattern) inverts the 6x6 once. Keyed by arc (WeakMap, so it is collected with the arc), then
 * by tRx. A small per-arc map suffices since a batch has few distinct reception epochs per arc.
 */
const receptionStmInverseCache = new WeakMap<Arc, Map<number, Float64Array>>();

function receptionStmInverse(arc: Arc, tRx: number): Float64Array {
  let perArc = receptionStmInverseCache.get(arc);
  if (perArc === undefined) {
    perArc = new Map();
    receptionStmInverseCache.set(arc, perArc);
  }
  const hit = perArc.get(tRx);
  if (hit !== undefined) return hit;
  const inv = invert6(arc.stmAt(tRx));
  perArc.set(tRx, inv);
  return inv;
}

/** C = A * B for two row-major 6x6 matrices. */
function matmul6(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 6; k++) {
      const aik = a[i * 6 + k]!;
      if (aik === 0) continue;
      for (let j = 0; j < 6; j++) out[i * 6 + j]! += aik * b[k * 6 + j]!;
    }
  }
  return out;
}

/** Invert a row-major 6x6 by Gauss-Jordan with partial pivoting. Throws on singularity. */
function invert6(a: Float64Array): Float64Array {
  const n = 6;
  const m = new Float64Array(n * 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m[i * 2 * n + j] = a[i * n + j]!;
    m[i * 2 * n + n + i] = 1;
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(m[col * 2 * n + col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r * 2 * n + col]!);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-300) throw new MeasurementError('predictLightTime: STM is singular, cannot rebase the partial');
    if (piv !== col) {
      for (let j = 0; j < 2 * n; j++) {
        const tmp = m[col * 2 * n + j]!;
        m[col * 2 * n + j] = m[piv * 2 * n + j]!;
        m[piv * 2 * n + j] = tmp;
      }
    }
    const d = m[col * 2 * n + col]!;
    for (let j = 0; j < 2 * n; j++) m[col * 2 * n + j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r * 2 * n + col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r * 2 * n + j]! -= f * m[col * 2 * n + j]!;
    }
  }
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) inv[i * n + j] = m[i * 2 * n + n + j]!;
  return inv;
}
