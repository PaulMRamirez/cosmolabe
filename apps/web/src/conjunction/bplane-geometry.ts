// Pure B-plane (encounter-plane) geometry for the conjunction viewer, plus the combined-
// encounter-plane covariance reduction. Given the two objects' states + 3x3 position
// covariances, combineEncounter builds the relative encounter frame (normal to the relative
// velocity), sums the two position covariances, and projects them (and the miss) into the 2x2
// in-plane covariance; buildBPlaneGeometry then turns that into the screen-space primitives the
// BPlaneView renders (1/3-sigma ellipses, miss point, hard-body circle) from the symmetric-2x2
// eigen-decomposition. This uses only the LIGHT @bessel/conjunction primitives (encounterPlane,
// projectCovarianceToEncounterPlane, the Foster integral), NOT the STM-propagation path, so the
// lazy chunk does not pull the propagator integrator. The combination is at the covariance
// reference epoch (for a CDM, the TCA itself), so no propagation to TCA is needed. No DOM, no
// SVG strings: it returns numbers in encounter-plane km so it can be unit-tested directly.

import {
  encounterPlane,
  projectCovarianceToEncounterPlane,
  collisionProbability2D,
  type Cov2x2,
} from '@bessel/conjunction';

/** A geometry error (loud, located) for a degenerate covariance/extent. */
export class BPlaneGeometryError extends Error {
  constructor(message: string) {
    super(`bplane geometry: ${message}`);
    this.name = 'BPlaneGeometryError';
  }
}

/** A 6-state [x,y,z,vx,vy,vz] (km, km/s). */
export type State6 = ArrayLike<number>;

/** The combined encounter-plane reduction: the 2x2 in-plane covariance, the projected miss, and
 *  the relative speed at the encounter. */
export interface CombinedEncounter {
  readonly cov2: Cov2x2;
  readonly missXKm: number;
  readonly missYKm: number;
  readonly missKm: number;
  readonly relSpeedKmS: number;
}

/**
 * Combine two objects' states + 3x3 inertial position covariances into the 2x2 encounter-plane
 * covariance + miss at the (shared) covariance epoch, without STM propagation. The two 3x3
 * position covariances sum into a relative position covariance (independent objects), the
 * encounter frame is built from the relative velocity (secondary minus primary), and the
 * relative covariance + miss project into the (u, v) plane. This is the short-arc reduction used
 * when both covariances are already referenced to the encounter epoch (a CDM is written at its
 * TCA), so propagating to TCA is the identity. Pure; throws (via encounterPlane) on a zero
 * relative velocity. The covariances are row-major length-9 inertial 3x3 (km^2).
 */
export function combineEncounter(
  primaryState6: State6,
  primaryPosCov3: ArrayLike<number>,
  secondaryState6: State6,
  secondaryPosCov3: ArrayLike<number>,
): CombinedEncounter {
  const relVel = {
    x: secondaryState6[3]! - primaryState6[3]!,
    y: secondaryState6[4]! - primaryState6[4]!,
    z: secondaryState6[5]! - primaryState6[5]!,
  };
  const frame = encounterPlane(relVel);
  // Relative (combined) 3x3 position covariance: independent objects, so covariances add.
  const rel3 = new Float64Array(9);
  for (let i = 0; i < 9; i++) rel3[i] = primaryPosCov3[i]! + secondaryPosCov3[i]!;
  const cov2 = projectCovarianceToEncounterPlane(rel3, frame);
  // Nominal miss (secondary minus primary) projected into the in-plane (u, v) axes.
  const rel = {
    x: secondaryState6[0]! - primaryState6[0]!,
    y: secondaryState6[1]! - primaryState6[1]!,
    z: secondaryState6[2]! - primaryState6[2]!,
  };
  const missXKm = rel.x * frame.u.x + rel.y * frame.u.y + rel.z * frame.u.z;
  const missYKm = rel.x * frame.v.x + rel.y * frame.v.y + rel.z * frame.v.z;
  return {
    cov2,
    missXKm,
    missYKm,
    missKm: Math.hypot(missXKm, missYKm),
    relSpeedKmS: Math.hypot(relVel.x, relVel.y, relVel.z),
  };
}

/** The eigen-decomposition of a symmetric 2x2 covariance: the two non-negative eigenvalues
 *  (variances along the principal axes, km^2) and the rotation (radians) of the major axis
 *  from the +x (encounter-plane u) axis. */
export interface Cov2Eigen {
  /** Larger eigenvalue (km^2), the major-axis variance. */
  readonly major: number;
  /** Smaller eigenvalue (km^2), the minor-axis variance. */
  readonly minor: number;
  /** Angle (radians) of the major axis from +x, in (-pi/2, pi/2]. */
  readonly angleRad: number;
}

/**
 * Eigen-decompose a symmetric 2x2 covariance [[cxx, cxy], [cxy, cyy]]. The eigenvalues are
 * lambda = (tr/2) +/- sqrt((tr/2)^2 - det); the major-axis angle is atan2 of the eigenvector
 * of the larger eigenvalue. Throws on a non-finite or non-positive-(semi)definite covariance.
 */
export function eigenCov2(cov: Cov2x2): Cov2Eigen {
  const { cxx, cxy, cyy } = cov;
  if (![cxx, cxy, cyy].every(Number.isFinite)) {
    throw new BPlaneGeometryError('covariance entries must be finite');
  }
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  // Positive-semidefinite check: trace and determinant both non-negative, diagonals non-negative.
  if (cxx < 0 || cyy < 0 || det < -1e-12 * (1 + Math.abs(tr))) {
    throw new BPlaneGeometryError(`covariance must be positive-semidefinite (cxx=${cxx}, cyy=${cyy}, det=${det})`);
  }
  const half = tr / 2;
  const disc = Math.sqrt(Math.max(0, half * half - det));
  const major = half + disc;
  const minor = Math.max(0, half - disc);
  // Major-axis eigenvector: for eigenvalue `major`, (cxx - major) ex + cxy ey = 0.
  // angle = atan2(major - cxx, cxy) is the rotation of the major axis from +x. When the
  // covariance is already axis-aligned (cxy ~ 0) the angle is 0 (cxx >= cyy) or pi/2.
  let angleRad: number;
  if (Math.abs(cxy) < 1e-15 * (1 + Math.abs(tr))) {
    angleRad = cxx >= cyy ? 0 : Math.PI / 2;
  } else {
    angleRad = Math.atan2(major - cxx, cxy);
  }
  return { major, minor, angleRad };
}

/**
 * Full-covariance encounter-plane Pc by diagonalizing the 2x2 covariance and reusing the
 * axis-aligned Foster integral (collisionProbability2D, already in the lazy chunk). Rotating the
 * encounter plane into the covariance principal axes makes the bivariate Gaussian axis-aligned
 * (sigmas = sqrt of the eigenvalues) and carries the miss vector along; the hard-body disk
 * integral is rotation-invariant, so the axis-aligned integral equals the cross-correlated
 * Mahalanobis integral. Returns Pc in [0, 1]; a singular covariance throws via eigenCov2.
 */
export function encounterPlanePc(cov: Cov2x2, missXKm: number, missYKm: number, radiusKm: number): number {
  const eigen = eigenCov2(cov);
  if (eigen.minor <= 0) throw new BPlaneGeometryError('encounter-plane covariance must be positive-definite for Pc');
  const c = Math.cos(eigen.angleRad);
  const s = Math.sin(eigen.angleRad);
  return collisionProbability2D({
    radiusKm,
    sigmaXKm: Math.sqrt(eigen.major),
    sigmaYKm: Math.sqrt(eigen.minor),
    missXKm: missXKm * c + missYKm * s, // miss along the major axis
    missYKm: -missXKm * s + missYKm * c, // miss along the minor axis
  });
}

/** One drawable ellipse: semi-axis lengths (km) and orientation (radians from +x). */
export interface SigmaEllipse {
  /** The sigma level (1 or 3) this ellipse draws. */
  readonly sigma: number;
  /** Semi-major axis length (km) = sigma * sqrt(major eigenvalue). */
  readonly semiMajorKm: number;
  /** Semi-minor axis length (km) = sigma * sqrt(minor eigenvalue). */
  readonly semiMinorKm: number;
  /** Orientation (radians) of the semi-major axis from +x. */
  readonly angleRad: number;
}

/** The full set of B-plane geometry primitives in encounter-plane kilometres. */
export interface BPlaneGeometry {
  /** Projected miss point (km) in the encounter (u, v) plane: u is +x, v is +y. */
  readonly missXKm: number;
  readonly missYKm: number;
  /** Miss magnitude (km). */
  readonly missKm: number;
  /** Combined hard-body radius (km), drawn as a circle at the miss point. */
  readonly radiusKm: number;
  /** The covariance eigen-decomposition (shared by both ellipses). */
  readonly eigen: Cov2Eigen;
  /** The 1- and 3-sigma covariance ellipses, centered at the origin (the secondary's mean is
   *  at the miss point; the covariance is the combined relative covariance about the miss). */
  readonly ellipses: readonly SigmaEllipse[];
  /** A symmetric half-extent (km) that frames the origin, miss point, the 3-sigma ellipse, and
   *  the hard-body circle, so the view can set an equal-aspect square viewbox. */
  readonly extentKm: number;
}

/** Build a sigma ellipse at a sigma level from an eigen-decomposition. */
function sigmaEllipse(eigen: Cov2Eigen, sigma: number): SigmaEllipse {
  return {
    sigma,
    semiMajorKm: sigma * Math.sqrt(eigen.major),
    semiMinorKm: sigma * Math.sqrt(eigen.minor),
    angleRad: eigen.angleRad,
  };
}

/**
 * Build the B-plane geometry from the combined encounter-plane covariance, the projected miss,
 * and the combined hard-body radius. The covariance is centered at the origin (the relative
 * uncertainty about the nominal relative state); the miss point is the nominal relative position
 * in the plane, and the hard-body circle sits at the miss point. The extent frames the origin,
 * the miss, the 3-sigma ellipse reach, and the hard-body circle with a small margin. Throws on a
 * negative radius or a degenerate covariance (via eigenCov2).
 */
export function buildBPlaneGeometry(cov: Cov2x2, missXKm: number, missYKm: number, radiusKm: number): BPlaneGeometry {
  if (![missXKm, missYKm, radiusKm].every(Number.isFinite)) {
    throw new BPlaneGeometryError('miss and radius must be finite');
  }
  if (radiusKm < 0) throw new BPlaneGeometryError(`hard-body radius must be non-negative (got ${radiusKm})`);
  const eigen = eigenCov2(cov);
  const ellipses = [sigmaEllipse(eigen, 1), sigmaEllipse(eigen, 3)];
  const missKm = Math.hypot(missXKm, missYKm);
  // The 3-sigma ellipse reaches sigma3-major from the origin; the hard-body circle reaches
  // missKm + radius. Frame the larger, with a 15% margin and a positive floor.
  const reach = Math.max(3 * Math.sqrt(eigen.major), missKm + radiusKm, 1e-6);
  const extentKm = reach * 1.15;
  return { missXKm, missYKm, missKm, radiusKm, eigen, ellipses, extentKm };
}

/** Sample an ellipse outline as `count` (x, y) km points, for an SVG polygon. The ellipse is
 *  centered at (cx, cy), with the given semi-axes rotated by `angleRad`. Pure. */
export function ellipsePoints(
  semiMajorKm: number,
  semiMinorKm: number,
  angleRad: number,
  cx: number,
  cy: number,
  count = 64,
): readonly (readonly [number, number])[] {
  const n = Math.max(8, Math.floor(count));
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const ex = semiMajorKm * Math.cos(th);
    const ey = semiMinorKm * Math.sin(th);
    pts.push([cx + ex * ca - ey * sa, cy + ex * sa + ey * ca]);
  }
  return pts;
}
