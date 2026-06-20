// A sequential extended Kalman filter for orbit determination. Measurements arrive in
// time order; for each one the filter does a time update then a measurement update:
//
//   Time update   (t_{k-1} -> t_k):
//     x_k^- = f(x_{k-1}^+, t_{k-1} -> t_k)            (nonlinear propagation)
//     Phi   = Phi(t_k, t_{k-1})                       (co-integrated STM)
//     P_k^- = Phi P_{k-1}^+ Phi^T + Q                 (Q process noise, optional)
//
//   Measurement update (standard EKF gain):
//     y   = obs - h(x_k^-)                            (innovation)
//     H   = dh/dx at x_k^-                            (size x 6)
//     S   = H P^- H^T + R                             (innovation covariance)
//     K   = P^- H^T S^-1                              (Kalman gain)
//     x^+ = x^- + K y
//     P^+ = (I - K H) P^-  (Joseph-stabilized below)
//
// The Joseph form keeps P^+ symmetric positive definite under finite precision.
// (Tapley-Schutz-Born §4.7; Vallado §10.3.)

import type { ForceModel } from '@bessel/propagator';
import { MeasurementError } from './errors.ts';
import {
  add,
  gaussSolve,
  identity,
  mat,
  matmul,
  sub,
  symmetrize,
  transpose,
  type Mat,
} from './linalg.ts';
import { noiseVariances, predict, residual } from './measurements.ts';
import { propagateArc } from './propagate.ts';
import { measurementSize, type Covariance6, type Measurement, type OdState } from './types.ts';

export interface EkfOptions {
  /** Force model defining the dynamics. */
  readonly forceModel: ForceModel;
  /** Optional static process noise Q (6x6 row-major, length 36) added each time update. */
  readonly processNoise?: Covariance6;
  /**
   * Optional state-noise compensation (SNC): a continuous white-noise acceleration of one-sigma
   * spectral density `sigmaAccel` (km/s^2 per sqrt(Hz), the sqrt of the acceleration PSD) on each
   * axis, integrated over each time-update span dt into the standard piecewise-constant-
   * acceleration Q block. This keeps the filter from growing overconfident on a mismodeled or
   * maneuvering truth (the no-process-noise filter then diverges as its covariance collapses).
   * Either an isotropic scalar (same on all three axes) or a per-axis triple. Added on top of any
   * static `processNoise`. (Tapley-Schutz-Born section 4.9, state-noise compensation.)
   */
  readonly snc?: { readonly sigmaAccel: number | readonly [number, number, number] };
  /** Inertial frame label passed to the propagator (default 'J2000'). */
  readonly frame?: string;
}

/** The filter state after a step: estimate, covariance, and the latest innovation RMS. */
export interface EkfStep {
  /** The a-posteriori 6-state at the measurement epoch. */
  readonly state: OdState;
  /** The a-posteriori 6x6 covariance (row-major, length 36). */
  readonly covariance: Float64Array;
  /** The post-update innovation (sigma-normalized) RMS for this measurement. */
  readonly innovationRms: number;
  /** Normalized Estimation Error Squared proxy: y^T S^-1 y for this measurement. */
  readonly nis: number;
}

/** A running EKF: feed measurements in ascending epoch order via `update`. */
export class ExtendedKalmanFilter {
  private x: Float64Array;
  private epoch: number;
  private p: Mat;
  private readonly q: Mat | undefined;
  /** Per-axis acceleration-noise variance (km^2/s^4 per Hz) for SNC, or undefined if off. */
  private readonly sncVar: readonly [number, number, number] | undefined;
  private readonly forceModel: ForceModel;
  private readonly frame: string;

  constructor(initial: OdState, initialCovariance: Covariance6, options: EkfOptions) {
    if (initial.x.length !== 6) throw new MeasurementError('EKF initial state must be length 6');
    if (initialCovariance.length !== 36) throw new MeasurementError('EKF initial covariance must be 6x6 (length 36)');
    this.x = Float64Array.from(initial.x);
    this.epoch = initial.epoch;
    this.p = symmetrize(mat(6, 6, Float64Array.from(initialCovariance)));
    this.q = options.processNoise ? mat(6, 6, Float64Array.from(options.processNoise)) : undefined;
    this.sncVar = options.snc ? sncVariance(options.snc.sigmaAccel) : undefined;
    this.forceModel = options.forceModel;
    this.frame = options.frame ?? 'J2000';
  }

  /** Current best estimate (a-posteriori after the last update). */
  current(): OdState {
    return { x: Float64Array.from(this.x), epoch: this.epoch };
  }

  /** Current covariance (row-major length 36). */
  currentCovariance(): Float64Array {
    return Float64Array.from(this.p.data);
  }

  /** Advance to `m.epoch` (time update) and fold in the measurement (measurement update). */
  update(m: Measurement): EkfStep {
    if (m.epoch < this.epoch - 1e-9) {
      throw new MeasurementError(`EKF measurements must be non-decreasing in epoch (got ${m.epoch} after ${this.epoch})`);
    }

    // Time update: propagate the state and map the covariance through the STM.
    if (m.epoch > this.epoch + 1e-12) {
      const dt = m.epoch - this.epoch;
      const arc = propagateArc(this.x, this.epoch, [m.epoch], this.forceModel, this.frame);
      this.x = arc.stateAt(m.epoch);
      const phi = mat(6, 6, arc.stmAt(m.epoch));
      const phiT = transpose(phi);
      let pMinus = matmul(matmul(phi, this.p), phiT);
      if (this.q) pMinus = add(pMinus, this.q);
      if (this.sncVar) pMinus = add(pMinus, sncQ(this.sncVar, dt));
      this.p = symmetrize(pMinus);
      this.epoch = m.epoch;
    } else if (this.q) {
      // Same-epoch measurement: still admit static process noise so stacked observations differ.
      this.p = symmetrize(add(this.p, this.q));
    }

    // Measurement update.
    const size = measurementSize(m);
    const pred = predict(m, this.x);
    const innov = residual(m, pred.value); // obs - model, size-length
    const H = mat(size, 6, pred.jac); // size x 6
    const Ht = transpose(H);
    const varns = noiseVariances(m);
    const R = mat(size, size);
    for (let i = 0; i < size; i++) R.data[i * size + i] = varns[i]!;

    const pHt = matmul(this.p, Ht); // 6 x size
    const S = add(matmul(H, pHt), R); // size x size
    // K = P H^T S^-1  <=>  K S = P H^T  <=>  S^T K^T = (P H^T)^T. Solve column by column.
    const K = solveGain(S, pHt); // 6 x size

    // x^+ = x^- + K innov.
    const Ky = matmul(K, mat(size, 1, innov));
    for (let i = 0; i < 6; i++) this.x[i]! += Ky.data[i]!;

    // Joseph form: P^+ = (I - K H) P (I - K H)^T + K R K^T.
    const I = identity(6);
    const ImKH = sub(I, matmul(K, H));
    const term1 = matmul(matmul(ImKH, this.p), transpose(ImKH));
    const term2 = matmul(matmul(K, R), transpose(K));
    this.p = symmetrize(add(term1, term2));

    // NIS = innov^T S^-1 innov, and the normalized innovation RMS.
    const sInvY = gaussSolve(S, innov);
    let nis = 0;
    for (let i = 0; i < size; i++) nis += innov[i]! * sInvY[i]!;
    const innovationRms = Math.sqrt(nis / size);

    return {
      state: this.current(),
      covariance: this.currentCovariance(),
      innovationRms,
      nis,
    };
  }
}

/** Per-axis acceleration-noise variance from the SNC sigma (scalar broadcast or a triple). */
function sncVariance(sigmaAccel: number | readonly [number, number, number]): [number, number, number] {
  if (typeof sigmaAccel === 'number') {
    if (!(sigmaAccel >= 0)) throw new MeasurementError(`EKF snc.sigmaAccel must be >= 0 (got ${sigmaAccel})`);
    const v = sigmaAccel * sigmaAccel;
    return [v, v, v];
  }
  return [sigmaAccel[0] ** 2, sigmaAccel[1] ** 2, sigmaAccel[2] ** 2];
}

/**
 * The state-noise-compensation process-noise block Q (6x6 row-major) for a continuous white-noise
 * acceleration of per-axis variance `var` integrated over span dt, the standard piecewise-
 * constant-acceleration form (Tapley-Schutz-Born eq. 4.9.41):
 *   Q_rr = (dt^3/3) var,  Q_rv = Q_vr = (dt^2/2) var,  Q_vv = dt var,  block-diagonal per axis.
 */
function sncQ(varAxis: readonly [number, number, number], dt: number): Mat {
  const q = new Float64Array(36);
  const rr = (dt * dt * dt) / 3;
  const rv = (dt * dt) / 2;
  const vv = dt;
  for (let a = 0; a < 3; a++) {
    const qa = varAxis[a]!;
    const pi = a; // position index
    const vi = a + 3; // velocity index
    q[pi * 6 + pi] = rr * qa;
    q[pi * 6 + vi] = rv * qa;
    q[vi * 6 + pi] = rv * qa;
    q[vi * 6 + vi] = vv * qa;
  }
  return mat(6, 6, q);
}

/** Solve K S = B for K, where B = P H^T is 6 x size and S is size x size (size 1 or 2). */
function solveGain(s: Mat, b: Mat): Mat {
  const size = s.rows;
  const k = new Float64Array(6 * size);
  // For each row of K (6 rows): solve S^T k_row^T = b_row^T  =>  since S symmetric, S k_row = b_row.
  const rowRhs = new Float64Array(size);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < size; c++) rowRhs[c] = b.data[r * size + c]!;
    const sol = gaussSolve(s, rowRhs);
    for (let c = 0; c < size; c++) k[r * size + c] = sol[c]!;
  }
  return mat(6, size, k);
}
