// Covariance propagation to the time of closest approach (TCA) and combination into
// an encounter-plane (B-plane) probability of collision. The epoch 6x6 state
// covariance of each object is mapped to TCA by the State Transition Matrix (STM):
// P(tca) = Phi P0 Phi^T, where Phi = dx(tca)/dx(epoch) is integrated from the
// variational equations (the @bessel/propagator STM machinery). The two propagated
// position covariances sum into a relative position covariance, which projects to a
// 2x2 in-plane covariance via the relative velocity at TCA, and Foster's encounter-
// plane integral (collisionProbabilityCov) yields Pc. The conjunction use-case is a
// short arc, so the default dynamics are point-mass (two-body); a caller may supply a
// richer ForceModel. (STK_PARITY_SPEC §4.8.)

import {
  augmentInitialState,
  makeStmRhs,
  integrate,
  createForceModel,
  pointMass,
  type ForceModel,
} from '@bessel/propagator';

import {
  CovarianceError,
  collisionProbabilityCov,
  encounterPlane,
  projectCovarianceToEncounterPlane,
  type Cov2x2,
} from './covariance.ts';
import type { Vec3 } from './index.ts';

/**
 * A symmetric 6x6 state covariance, row-major (length 36). The state ordering matches
 * the propagator 6-state: [x, y, z, vx, vy, vz] (km, km/s); entry (i, j) is at index
 * i * 6 + j. The top-left 3x3 block is the position covariance (km^2).
 */
export type Cov6x6 = ArrayLike<number>;

/** A 6-state [x, y, z, vx, vy, vz] (km, km/s), length 6. */
export type State6 = ArrayLike<number>;

const TWO_BODY_MU_EARTH = 398600.4418;

/** Read entry (r, c) of a row-major NxN matrix backed by an ArrayLike. */
const at = (m: ArrayLike<number>, n: number, r: number, c: number): number => m[r * n + c]!;

/**
 * Validate a row-major 6x6 covariance: length 36, all finite, symmetric within a
 * scaled tolerance, and symmetric-positive-definite (all leading principal minors
 * positive, by Cholesky). Throws a located CovarianceError otherwise.
 */
function assertCov6x6(cov: Cov6x6, label: string): void {
  if (cov.length !== 36) {
    throw new CovarianceError(`${label} 6x6 covariance must have length 36 (got ${cov.length})`);
  }
  for (let i = 0; i < 36; i++) {
    if (!Number.isFinite(cov[i]!)) {
      throw new CovarianceError(`${label} 6x6 covariance entry ${i} is not finite`);
    }
  }
  // Symmetry: scale the tolerance by the diagonal magnitude.
  let diagScale = 1;
  for (let i = 0; i < 6; i++) diagScale += Math.abs(at(cov, 6, i, i));
  const symTol = 1e-9 * diagScale;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      if (Math.abs(at(cov, 6, i, j) - at(cov, 6, j, i)) > symTol) {
        throw new CovarianceError(`${label} 6x6 covariance must be symmetric (entry ${i},${j} != ${j},${i})`);
      }
    }
  }
  // Positive-definiteness by Cholesky: L L^T = P succeeds only if P is SPD.
  if (!choleskySpd(cov, 6)) {
    throw new CovarianceError(`${label} 6x6 covariance must be positive-definite`);
  }
}

/**
 * Cholesky positive-definite test for a row-major symmetric NxN matrix: returns true
 * when L L^T = M succeeds with strictly positive pivots, false otherwise. The lower
 * factor L (when requested) is written into `out` (row-major, length N*N, lower
 * triangle filled, upper zero).
 */
function choleskySpd(m: ArrayLike<number>, n: number, out?: Float64Array): boolean {
  const L = out ?? new Float64Array(n * n);
  if (out) L.fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = at(m, n, i, j);
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (sum <= 0) return false;
        L[i * n + j] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j]!;
      }
    }
  }
  return true;
}

/** The default short-arc dynamics: a single point-mass (two-body) term for `mu`. */
export function twoBodyForceModel(mu = TWO_BODY_MU_EARTH): ForceModel {
  return createForceModel([pointMass(mu)]);
}

/**
 * Lower-triangular Cholesky factor L (row-major, length N*N) of a symmetric positive-
 * definite row-major NxN matrix, with L L^T = M. The factor maps standard-normal draws
 * z to correlated samples L z with covariance M, the operation a Monte-Carlo sampler
 * needs. Throws a located CovarianceError when M is not positive-definite.
 */
export function choleskyLower(m: ArrayLike<number>, n: number): Float64Array {
  if (m.length !== n * n) {
    throw new CovarianceError(`choleskyLower expects a ${n}x${n} matrix (length ${n * n}, got ${m.length})`);
  }
  const L = new Float64Array(n * n);
  if (!choleskySpd(m, n, L)) {
    throw new CovarianceError('choleskyLower requires a positive-definite matrix');
  }
  return L;
}

/**
 * Integrate the 42-state augmented system (state + the 36 STM entries) from the state
 * epoch (t = 0) to `tcaSec` and return BOTH the propagated 6-state and the 6x6 STM
 * Phi(tca, 0), each row-major. The single augmented integration already carries the
 * propagated state in yf[0..6) and the STM in yf[6..42), so we read both from it rather
 * than re-integrating the bare 6-state separately. `tcaSec` may be negative (TCA before
 * the epoch): the augmented system is integrated in the reversed time variable tau = -t,
 * which leaves Phi(tca, 0) unchanged because the variational equations are time-symmetric
 * for the (conservative) force model.
 */
function propagateStateAndStm(
  state6: State6,
  tcaSec: number,
  model: ForceModel,
): { state: Float64Array; phi: Float64Array } {
  if (state6.length !== 6) {
    throw new CovarianceError(`state must be a 6-state (got length ${state6.length})`);
  }
  if (!Number.isFinite(tcaSec)) {
    throw new CovarianceError(`tcaSec must be finite (got ${tcaSec})`);
  }
  const s6 = Float64Array.from({ length: 6 }, (_, i) => state6[i]!);
  if (tcaSec === 0) {
    // Phi(t0, t0) = identity; the state is unchanged, so no integration is needed.
    const phi = new Float64Array(36);
    for (let i = 0; i < 6; i++) phi[i * 6 + i] = 1;
    return { state: s6, phi };
  }
  const y0 = augmentInitialState(s6);
  let yf: Float64Array;
  if (tcaSec > 0) {
    yf = integrate(makeStmRhs(model), y0, 0, Float64Array.of(tcaSec))[0]!;
  } else {
    // Backward propagation: integrate in tau = -t over [0, -tcaSec]. The reversed RHS is
    // f_rev(tau, y) = -f(-tau, y); dy/dt = f, so dy/dtau = -f. The integrator only marches
    // forward, so we wrap the STM RHS with a sign flip and a negated time argument.
    const fwd = makeStmRhs(model);
    const buf = new Float64Array(42);
    const revRhs = (tau: number, y: Float64Array, dy: Float64Array): void => {
      fwd(-tau, y, buf);
      for (let i = 0; i < 42; i++) dy[i] = -buf[i]!;
    };
    yf = integrate(revRhs, y0, 0, Float64Array.of(-tcaSec))[0]!;
  }
  return { state: yf.slice(0, 6), phi: yf.slice(6, 42) };
}

/** Multiply two row-major NxN matrices: C = A B. */
function matMul(a: ArrayLike<number>, b: ArrayLike<number>, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k]!;
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) c[i * n + j]! += aik * b[k * n + j]!;
    }
  }
  return c;
}

/** Transpose a row-major NxN matrix. */
function transpose(a: ArrayLike<number>, n: number): Float64Array {
  const t = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t[j * n + i] = a[i * n + j]!;
  return t;
}

/** Symmetrize a row-major NxN matrix in place: M <- (M + M^T) / 2. */
function symmetrize(m: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const avg = 0.5 * (m[i * n + j]! + m[j * n + i]!);
      m[i * n + j] = avg;
      m[j * n + i] = avg;
    }
  }
}

export interface PropagatedCovariance {
  /** The 6x6 STM Phi(tca, epoch), row-major (length 36). */
  readonly phi: Float64Array;
  /** The propagated 6x6 covariance P(tca) = Phi P0 Phi^T, row-major (length 36). */
  readonly cov: Float64Array;
  /** The propagated 6-state at TCA, [x, y, z, vx, vy, vz] (km, km/s). */
  readonly state: Float64Array;
}

/**
 * Propagate a 6x6 epoch state covariance to `tcaSec` via the STM: P(tca) = Phi P0 Phi^T.
 * The covariance must be a row-major length-36 symmetric positive-definite matrix in the
 * propagator state ordering [x, y, z, vx, vy, vz]; the position block is the top-left
 * 3x3. The default dynamics are point-mass two-body (short-arc conjunction regime); pass
 * `forceModel` for richer dynamics. Throws a located CovarianceError on a malformed or
 * non-positive-definite covariance, or a non-finite TCA.
 */
export function propagateCovarianceToTca(
  state6: State6,
  cov6x6: Cov6x6,
  tcaSec: number,
  forceModel: ForceModel = twoBodyForceModel(),
): PropagatedCovariance {
  assertCov6x6(cov6x6, 'epoch');
  // One augmented integration yields both the propagated state and the STM (the state was
  // already in the augmented solution, so there is no separate bare-6-state re-integration).
  const { state, phi } = propagateStateAndStm(state6, tcaSec, forceModel);
  // P(tca) = Phi P0 Phi^T.
  const p0Phi = matMul(cov6x6, transpose(phi, 6), 6);
  const cov = matMul(phi, p0Phi, 6);
  symmetrize(cov, 6); // strip the small numerical asymmetry the triple product accrues
  return { phi, cov, state };
}

/** Extract the top-left 3x3 position block (row-major, length 9) from a 6x6 covariance. */
function positionBlock3x3(cov6: ArrayLike<number>): Float64Array {
  const out = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = cov6[i * 6 + j]!;
  return out;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

const stateToPos = (s: ArrayLike<number>): Vec3 => ({ x: s[0]!, y: s[1]!, z: s[2]! });
const stateToVel = (s: ArrayLike<number>): Vec3 => ({ x: s[3]!, y: s[4]!, z: s[5]! });

export interface CombinedEncounterCovariance {
  /** The 2x2 in-plane combined (relative) position covariance (km^2). */
  readonly cov2: Cov2x2;
  /** The nominal relative miss vector projected into the encounter plane (km). */
  readonly missXKm: number;
  readonly missYKm: number;
  /** Miss magnitude in the encounter plane (km). */
  readonly missKm: number;
  /** Relative speed at TCA (km/s). */
  readonly relSpeedKmS: number;
}

/**
 * Propagate both objects' epoch covariances and states to `tcaSec`, sum their 3x3
 * position covariances into a relative position covariance, and project it (plus the
 * relative miss) into the 2x2 encounter-plane covariance using the relative velocity at
 * TCA. The encounter plane is normal to the relative velocity (secondary minus primary).
 * `mu` selects the default two-body central-body GM for both propagations. Throws a
 * located CovarianceError on bad inputs (malformed covariance, zero relative velocity).
 */
export function combinedEncounterCovariance(
  primaryState6: State6,
  primaryCov6: Cov6x6,
  secondaryState6: State6,
  secondaryCov6: Cov6x6,
  tcaSec: number,
  mu = TWO_BODY_MU_EARTH,
): CombinedEncounterCovariance {
  const model = twoBodyForceModel(mu);
  const a = propagateCovarianceToTca(primaryState6, primaryCov6, tcaSec, model);
  const b = propagateCovarianceToTca(secondaryState6, secondaryCov6, tcaSec, model);

  // Relative (combined) position covariance: independent objects, so covariances add.
  const pa = positionBlock3x3(a.cov);
  const pb = positionBlock3x3(b.cov);
  const rel3 = new Float64Array(9);
  for (let i = 0; i < 9; i++) rel3[i] = pa[i]! + pb[i]!;

  // Encounter frame from the relative velocity (secondary with respect to primary).
  const relVel = sub3(stateToVel(b.state), stateToVel(a.state));
  const frame = encounterPlane(relVel);
  const cov2 = projectCovarianceToEncounterPlane(rel3, frame);

  // Nominal miss (secondary minus primary) projected into the in-plane (u, v) axes.
  const relPos = sub3(stateToPos(b.state), stateToPos(a.state));
  const missXKm = relPos.x * frame.u.x + relPos.y * frame.u.y + relPos.z * frame.u.z;
  const missYKm = relPos.x * frame.v.x + relPos.y * frame.v.y + relPos.z * frame.v.z;
  const relSpeedKmS = Math.hypot(relVel.x, relVel.y, relVel.z);

  return {
    cov2,
    missXKm,
    missYKm,
    missKm: Math.hypot(missXKm, missYKm),
    relSpeedKmS,
  };
}

/**
 * End-to-end propagated probability of collision: propagate both epoch covariances to
 * TCA, combine and project into the encounter plane, and integrate Foster's encounter-
 * plane Pc over the combined hard-body disk (`radiusKm`). `samples` sets the polar
 * quadrature resolution. Returns Pc in [0, 1].
 */
export function collisionProbabilityPropagated(
  primaryState6: State6,
  primaryCov6: Cov6x6,
  secondaryState6: State6,
  secondaryCov6: Cov6x6,
  tcaSec: number,
  radiusKm: number,
  mu = TWO_BODY_MU_EARTH,
  samples = 240,
): number {
  const enc = combinedEncounterCovariance(
    primaryState6,
    primaryCov6,
    secondaryState6,
    secondaryCov6,
    tcaSec,
    mu,
  );
  return collisionProbabilityCov(
    { radiusKm, missXKm: enc.missXKm, missYKm: enc.missYKm, cov: enc.cov2 },
    samples,
  );
}
