// @bessel/conjunction: close-approach math. Time of closest approach (TCA) and
// miss distance for relative motion, and the 2D probability of collision (Pc) in
// the encounter plane (Foster's method). Pure; the screening/propagation pipeline
// layers on top. (STK_PARITY_SPEC §4.8.)

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ClosestApproach {
  /** Time of closest approach, relative to the state epoch (s). */
  readonly tca: number;
  /** Miss distance at TCA (km). */
  readonly missKm: number;
  /** Relative speed at TCA (km/s). */
  readonly relSpeedKmS: number;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Closest approach for rectilinear relative motion: relative position `relPos`
 * and velocity `relVel` (target minus chaser). TCA is where the range rate is zero.
 */
export function closestApproachLinear(relPos: Vec3, relVel: Vec3): ClosestApproach {
  const v2 = dot(relVel, relVel);
  const tca = v2 > 0 ? -dot(relPos, relVel) / v2 : 0;
  const at: Vec3 = {
    x: relPos.x + relVel.x * tca,
    y: relPos.y + relVel.y * tca,
    z: relPos.z + relVel.z * tca,
  };
  return { tca, missKm: Math.sqrt(dot(at, at)), relSpeedKmS: Math.sqrt(v2) };
}

export interface PcInput {
  /** Combined hard-body radius (km): sum of the two objects' radii. */
  readonly radiusKm: number;
  /** Encounter-plane 1-sigma position uncertainties (km), aligned to the axes. */
  readonly sigmaXKm: number;
  readonly sigmaYKm: number;
  /** Nominal miss vector projected into the encounter plane (km). */
  readonly missXKm: number;
  readonly missYKm: number;
}

/**
 * Probability of collision in the 2D encounter plane (Foster): integrate the
 * bivariate Gaussian (axis-aligned covariance, mean at the miss vector) over the
 * combined hard-body disk of radius `radiusKm`, via polar quadrature.
 */
export {
  screenAllVsAll,
  ScreenError,
  type SampledEphemeris,
  type ConjunctionEvent,
  type ScreenOptions,
} from './screen.ts';

export {
  collisionProbabilityCov,
  encounterPlane,
  projectCovarianceToEncounterPlane,
  CovarianceError,
  type Cov2x2,
  type EncounterFrame,
  type PcCovInput,
} from './covariance.ts';

export { maxCollisionProbability } from './max-pc.ts';

export {
  propagateCovarianceToTca,
  combinedEncounterCovariance,
  collisionProbabilityPropagated,
  twoBodyForceModel,
  choleskyLower,
  type Cov6x6,
  type State6,
  type PropagatedCovariance,
  type CombinedEncounterCovariance,
} from './cov-propagation.ts';

export function collisionProbability2D(input: PcInput, samples = 240): number {
  const { radiusKm: R, sigmaXKm: sx, sigmaYKm: sy, missXKm: mx, missYKm: my } = input;
  if (R <= 0 || sx <= 0 || sy <= 0) return 0;
  const norm = 1 / (2 * Math.PI * sx * sy);
  const nr = samples;
  const nt = samples;
  const dr = R / nr;
  const dt = (2 * Math.PI) / nt;
  let pc = 0;
  for (let ir = 0; ir < nr; ir++) {
    const r = (ir + 0.5) * dr; // midpoint
    for (let it = 0; it < nt; it++) {
      const th = (it + 0.5) * dt;
      const x = r * Math.cos(th) - mx;
      const y = r * Math.sin(th) - my;
      const g = Math.exp(-0.5 * ((x * x) / (sx * sx) + (y * y) / (sy * sy)));
      pc += norm * g * r * dr * dt; // polar area element r dr dtheta
    }
  }
  return Math.min(1, pc);
}
