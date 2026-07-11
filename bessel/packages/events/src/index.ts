// @bessel/events: temporal geometry events (eclipse / lighting intervals). Reduces
// to the proven geometry-finder + window substrate: classifies the occultation of
// the Sun (an extended body) by a central body, as seen from an observer, into
// umbra / penumbra / annular / sunlit windows. Core layer: depends only on
// @bessel/spice and @bessel/timeline. (STK_PARITY_SPEC §4.9, Phase B.)

import type { AberrationCorrection, SpiceEngine } from '@bessel/spice';
import { windowComplement, windowUnionAll, type EphemerisTime, type Window } from '@bessel/timeline';

export interface EclipseRequest {
  /** Observer (satellite/spacecraft) SPICE id or name. */
  readonly observer: string;
  /** Eclipsing central body (e.g. "EARTH", "SATURN"). */
  readonly body: string;
  /** Body-fixed frame of the eclipsing body (e.g. "IAU_EARTH"). */
  readonly bodyFrame: string;
  /** Search span [start, stop] in ET seconds. */
  readonly span: readonly [EphemerisTime, EphemerisTime];
  /** Geometry-finder search step (s). */
  readonly step: number;
  readonly abcorr?: AberrationCorrection;
  /** The illuminating body and its frame; defaults to the Sun. */
  readonly light?: { readonly body: string; readonly frame: string };
}

/** Eclipse condition windows over the span. They partition the span. */
export interface EclipseIntervals {
  /** Sun fully occulted by the body (total shadow). */
  readonly umbra: Window;
  /** Sun partially occulted (ingress/egress). */
  readonly penumbra: Window;
  /** Body fully inside the Sun's disk (annular). */
  readonly annular: Window;
  /** Sun unobstructed. */
  readonly sunlit: Window;
}

/**
 * Compute umbra/penumbra/annular/sunlit intervals: the occultation of the light
 * source (Sun, modeled as an ellipsoid) by `body`, as seen from the observer.
 */
export async function eclipseIntervals(
  spice: SpiceEngine,
  req: EclipseRequest,
): Promise<EclipseIntervals> {
  const [t0, t1] = req.span;
  const abcorr = req.abcorr ?? 'NONE';
  const light = req.light ?? { body: 'SUN', frame: 'IAU_SUN' };
  const occ = (occtyp: string): Promise<[number, number][]> =>
    spice.gfoclt(
      occtyp,
      req.body,
      'ELLIPSOID',
      req.bodyFrame,
      light.body,
      'ELLIPSOID',
      light.frame,
      abcorr,
      req.observer,
      req.step,
      t0,
      t1,
    );
  const umbra = await occ('FULL');
  const penumbra = await occ('PARTIAL');
  const annular = await occ('ANNULAR');
  const sunlit = windowComplement(t0, t1, windowUnionAll([umbra, penumbra, annular]));
  return { umbra, penumbra, annular, sunlit };
}

export {
  betaAngle,
  betaAngleSeries,
  DegenerateOrbitError,
  type BetaAngleSeries,
} from './beta.ts';

export {
  solarIntensity,
  solarIntensitySeries,
  overlapArea,
  visibleFraction,
  IntensityGeometryError,
  type SolarIntensityOptions,
  type SolarIntensitySeries,
} from './intensity.ts';
