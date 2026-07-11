// Lighting & Geometry domain ops (analysis-UX Phase 1, design section 3 tab 2). Split
// out of analysis-ops.ts so the heavier @bessel/events beta + intensity paths surface
// here without bloating the shared ops module. Each function mirrors the analysis-ops
// pattern: async, takes the engine core + store + a disposed guard (+ a span override),
// writes one store slice, and fails loud (console.error + rethrow) on failure. The
// engine.ts wrappers reach this module through the same dynamic-import code-split seam.

import { betaAngleSeries, eclipseIntervals, solarIntensitySeries } from '@bessel/events';
import type { AppStore } from '../store/index.ts';
import type { EngineCore } from './bootstrap.ts';
import type { AnalysisSpan } from './analysis-ops.ts';
import { RAD2DEG } from '../angles.ts';

const SECONDS_PER_DAY = 86400;

/** Default span (s) for a lighting-season analysis: one full year so the beta angle
 *  sweeps through its eclipse-season excursions, when no override is supplied. */
const DEFAULT_SEASON_SPAN_SEC = 365 * SECONDS_PER_DAY;
/** Default beta/intensity sampling step (s): coarse enough to keep a year responsive. */
const DEFAULT_SEASON_STEP_SEC = 3 * 3600;
/** Cap on samples for the sequential (unbatched) beta/intensity sweeps: each sample is a
 *  worker round-trip, so a fine context step over a long span must be coarsened to stay
 *  responsive. The season shape is preserved at this resolution. */
const MAX_SEASON_SAMPLES = 400;

/** Coarsen the requested step so a span yields at most MAX_SEASON_SAMPLES samples. The
 *  sequential beta/intensity series would otherwise issue one worker round-trip per
 *  sample; this keeps a fine shared-context step from making the sweep unresponsive. */
function seasonStep(spanSec: number, requestedStep: number): number {
  const minStep = spanSec / MAX_SEASON_SAMPLES;
  return Math.max(requestedStep, minStep);
}

/** Mean (sphere-equivalent) radius (km) of a body from its bodvrd RADII triaxial values. */
async function meanRadiusKm(e: EngineCore, body: string): Promise<number> {
  const radii = await e.spice.bodvrd(body, 'RADII');
  if (radii.length < 3) {
    throw new RangeError(`ops-lighting: bodvrd ${body} RADII returned ${radii.length} values (expected 3)`);
  }
  return (radii[0]! + radii[1]! + radii[2]!) / 3;
}

/**
 * Eclipse-onset half-angle (deg) for a circular orbit of mean radius `orbitRadiusKm`
 * about a body of mean radius `bodyRadiusKm`: the satellite is in eclipse season while
 * |beta| < asin(bodyRadius / orbitRadius). Below this beta the orbit plane dips behind
 * the body's shadow cylinder; above it the orbit stays sunlit for the whole revolution.
 */
export function eclipseOnsetDeg(bodyRadiusKm: number, orbitRadiusKm: number): number {
  if (!(orbitRadiusKm > bodyRadiusKm)) return 90;
  return Math.asin(bodyRadiusKm / orbitRadiusKm) * RAD2DEG;
}

/**
 * Beta-angle season series: sample the solar beta angle (deg) of the spacecraft about
 * its center body over the span (default one year), and annotate it with the body's
 * eclipse-onset threshold so the panel can mark when the orbit enters eclipse season
 * (|beta| below the onset angle). Requires a spacecraft mission.
 */
export async function computeBetaSeries(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ betaSeries: null });
    return;
  }
  const t0 = e.clock.state.et;
  const spanSec = opts.spanSec ?? DEFAULT_SEASON_SPAN_SEC;
  const span: [number, number] = [t0, t0 + spanSec];
  const step = seasonStep(spanSec, opts.stepSec ?? DEFAULT_SEASON_STEP_SEC);
  try {
    const beta = await betaAngleSeries(e.spice, sc, body, span, step);
    // Eclipse-onset threshold from the current orbit radius and the body's mean radius:
    // |r| from spkpos at the epoch gives a representative orbit radius for the season.
    const sp = await e.spice.spkpos(sc, t0, 'J2000', 'NONE', body);
    const orbitRadiusKm = Math.hypot(sp.position.x, sp.position.y, sp.position.z);
    const bodyRadiusKm = await meanRadiusKm(e, body);
    const onsetDeg = eclipseOnsetDeg(bodyRadiusKm, orbitRadiusKm);
    if (!isDisposed()) {
      store.setState({
        betaSeries: {
          series: { et: beta.et, value: beta.valueDeg, label: `${sc} about ${body} beta angle (deg)` },
          onsetDeg,
          span,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ betaSeries: null });
    console.error('beta-angle season analysis failed', err);
    throw err;
  }
}

/** Total seconds covered by a set of (start, stop) windows. */
export function windowTotalSec(windows: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (const [a, b] of windows) total += b - a;
  return total;
}

/**
 * Full eclipse phases: classify the occultation of the Sun by the center body, as seen
 * from the spacecraft, into umbra / penumbra / annular / sunlit windows over the span
 * (default one day), and reduce the shadowed (umbra + penumbra + annular) total to a
 * per-mean-day duration, and store them as the eclipsePhases slice. Requires a
 * spacecraft mission.
 */
export async function computeEclipsePhases(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ eclipsePhases: null });
    return;
  }
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? SECONDS_PER_DAY)];
  try {
    const ecl = await eclipseIntervals(e.spice, {
      observer: sc,
      body,
      bodyFrame: `IAU_${body.toUpperCase()}`,
      span,
      step: opts.stepSec ?? 120,
    });
    const shadowedSec = windowTotalSec(ecl.umbra) + windowTotalSec(ecl.penumbra) + windowTotalSec(ecl.annular);
    const spanDays = (span[1] - span[0]) / SECONDS_PER_DAY;
    const shadowSecPerDay = spanDays > 0 ? shadowedSec / spanDays : 0;
    if (!isDisposed()) {
      store.setState({
        eclipsePhases: {
          umbra: ecl.umbra,
          penumbra: ecl.penumbra,
          annular: ecl.annular,
          sunlit: ecl.sunlit,
          span,
          shadowSecPerDay,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ eclipsePhases: null });
    console.error('eclipse analysis failed', err);
    throw err;
  }
}

/**
 * Solar intensity (penumbra fraction): sample the visible fraction of the Sun's disk
 * (0..1) from the spacecraft, occulted by the center body, over the span. 1 is full
 * sun, 0 is total umbra, and the gradient in between is the penumbra. Useful as a
 * power/thermal driver. Requires a spacecraft mission.
 */
export async function computeSolarIntensity(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ solarIntensitySeries: null });
    return;
  }
  const t0 = e.clock.state.et;
  const spanSec = opts.spanSec ?? SECONDS_PER_DAY;
  const span: [number, number] = [t0, t0 + spanSec];
  const step = seasonStep(spanSec, opts.stepSec ?? 120);
  try {
    const intensity = await solarIntensitySeries(e.spice, sc, body, `IAU_${body.toUpperCase()}`, span, step);
    if (!isDisposed()) {
      store.setState({
        solarIntensitySeries: {
          et: intensity.et,
          value: intensity.fraction,
          label: `${sc} visible solar fraction (0..1)`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ solarIntensitySeries: null });
    console.error('solar-intensity analysis failed', err);
    throw err;
  }
}
