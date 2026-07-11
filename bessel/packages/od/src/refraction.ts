// Tropospheric refraction for the elevation (and the radec declination) measurement model.
// Light bends as it descends through the denser lower atmosphere, so a target appears HIGHER
// than its straight-line geometric elevation: the apparent elevation exceeds the true elevation
// by a refraction angle R(el) that grows from ~0 at the zenith to a few milliradians at low
// elevation. A station's az/el observable is the APPARENT (refracted) elevation, so the
// geometric model prediction must be raised by R before it is differenced with the observation.
//
// We use Bennett's (1982) formula, the standard closed-form approximation (USNO NOVAS uses it):
//   R(deg) = (1 / 60) * cot( el + 7.31 / (el + 4.4) )    with el in degrees, cot's argument in
// degrees, then scaled to the actual site pressure/temperature by (P / 1010) * (283 / T). At
// 10 deg elevation this is ~5.4 arcmin = 1.57 mrad, matching tabulated standard refraction.
// References: G. G. Bennett, "The Calculation of Astronomical Refraction in Marine Navigation",
// Journal of Navigation 35 (1982) 255-259; Vallado, "Fundamentals of Astrodynamics and
// Applications", section 4.4 (observation corrections); Seidelmann, Explanatory Supplement.

const DEG = Math.PI / 180;

/** Standard sea-level conditions Bennett's bare formula assumes. */
const P0_MBAR = 1010;
const T0_K = 283.15;

/**
 * Lowest geometric elevation at which refraction is modeled (rad), about -0.5 deg. A target
 * whose geometric elevation is below the horizon is not visible (no ray bends a sub-horizon
 * target into view in this single-station model), and Bennett's formula, evaluated below the
 * horizon, returns a spuriously large positive correction. Below this floor the refraction
 * contribution is zero. The small negative margin admits a target just beneath the geometric
 * horizon that standard refraction genuinely lifts into view (the ~34 arcmin horizon dip).
 */
export const MIN_REFRACTION_ELEVATION_RAD = -0.5 * (Math.PI / 180);

/** Site weather for the pressure/temperature scaling of the refraction (optional). */
export interface RefractionConditions {
  /** Surface pressure (millibar / hPa). Default 1010. */
  readonly pressureMbar?: number;
  /** Surface temperature (kelvin). Default 283.15. */
  readonly temperatureK?: number;
}

/**
 * Bennett tropospheric refraction angle (radians) at a geometric (true) elevation `elRad`. The
 * apparent elevation is el + R(el). Positive for elevations below the zenith, monotonically
 * decreasing in elevation; clamped to be non-negative (no negative refraction is modeled).
 * Below MIN_REFRACTION_ELEVATION_RAD the target is beneath the horizon and the contribution is
 * zero: applying Bennett's formula there returns a spuriously large positive bend that would lift
 * a sub-horizon target into a fake pass. Optional site pressure/temperature scale it linearly.
 */
export function bennettRefraction(elRad: number, conditions?: RefractionConditions): number {
  // Below the horizon floor refraction is not modeled: return no correction rather than a bogus
  // large value. The geometry finder must not raise a sub-horizon target into view.
  if (elRad < MIN_REFRACTION_ELEVATION_RAD) return 0;
  const elDeg = elRad / DEG;
  // Bennett's argument; the elevation is at or above the horizon floor so cot stays finite.
  const elArg = elDeg;
  const arg = (elArg + 7.31 / (elArg + 4.4)) * DEG;
  const rDeg = (1 / 60) / Math.tan(arg); // standard-conditions refraction (degrees)
  let r = rDeg * DEG; // radians
  // Scale to the site's pressure and temperature (the density ratio, Bennett's note).
  const p = conditions?.pressureMbar ?? P0_MBAR;
  const t = conditions?.temperatureK ?? T0_K;
  r *= (p / P0_MBAR) * (T0_K / t);
  return Math.max(0, r);
}

/**
 * Derivative dR/del (dimensionless, radian per radian) of the Bennett refraction, by central
 * difference: needed when the refraction-corrected elevation partial is wanted to high accuracy.
 * Small (the refraction varies slowly with elevation except very near the horizon), so the base
 * geometric d(el)/dx partial is an excellent approximation and this is exposed for completeness.
 */
export function bennettRefractionSlope(elRad: number, conditions?: RefractionConditions): number {
  const h = 1e-6;
  return (bennettRefraction(elRad + h, conditions) - bennettRefraction(elRad - h, conditions)) / (2 * h);
}
