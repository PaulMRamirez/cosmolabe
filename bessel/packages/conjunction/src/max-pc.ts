// Maximum probability of collision (Alfano / Frisbee). For a fixed projected miss
// distance and combined hard-body radius, the encounter-plane Pc depends on the
// covariance; sweeping over all covariance shapes, orientations, and scales gives a
// worst-case upper bound used to triage conjunctions when the covariance is unknown
// or distrusted. Pure math. (STK_PARITY_SPEC §4.8.)

import { CovarianceError } from './covariance.ts';

/**
 * Maximum probability of collision over all encounter-plane covariances for a given
 * miss distance and combined hard-body radius (Alfano 2005, "Relating Position
 * Uncertainty to the Maximum Probability of Collision", AAS 05-128; Frisbee, Maximum
 * Probability).
 *
 * The hard-body disk of radius R is small relative to the uncertainty, so the
 * bivariate-Gaussian density is locally flat across it and Pc ~= (area) * (density at
 * the closest disk edge). The maximizing covariance orients one principal axis along
 * the miss direction and the other across it; for a fixed off-axis miss the density
 * is largest when the across-track sigma collapses toward zero and the along-track
 * sigma is tuned to sigma = m. Carrying out that maximization (Alfano's closed form)
 * gives
 *
 *   Pc_max = (R / m) * sqrt(2 / pi) * exp(-1/2),
 *
 * an upper bound (in the small hard-body limit R << m, the regime where max-Pc is
 * applied) that holds for ANY (including elongated, rotated, cross-correlated)
 * encounter-plane covariance, which the circular-family result R^2 / (m^2 e) does
 * not. The constant sqrt(2/pi) * exp(-1/2) ~= 0.4839. (When R is comparable to m the
 * small-disk approximation degrades and the exact integral can creep above this
 * value; that regime is outside the standard max-Pc use.) Throws on a non-positive or
 * non-finite radius; a non-positive miss returns 1 (collision certain in the limit).
 */
const MAX_PC_CONST = Math.sqrt(2 / Math.PI) * Math.exp(-0.5); // ~= 0.48394

export function maxCollisionProbability(missDistanceKm: number, radiusKm: number): number {
  if (!Number.isFinite(missDistanceKm) || !Number.isFinite(radiusKm)) {
    throw new CovarianceError('miss distance and radius must be finite');
  }
  if (radiusKm <= 0) {
    throw new CovarianceError(`radius must be positive (got ${radiusKm})`);
  }
  if (missDistanceKm <= 0) {
    // A zero miss puts the maximum-density point at the disk center; the maximum tends
    // to 1 (collision is certain in the limit).
    return 1;
  }
  const pc = (radiusKm / missDistanceKm) * MAX_PC_CONST;
  return Math.min(1, pc);
}
