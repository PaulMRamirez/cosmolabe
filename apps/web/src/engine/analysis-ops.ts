// The analysis-engine operations, split out of BesselEngine so they (and the heavy
// @bessel analysis packages they import) land in a lazy chunk instead of the first-paint
// bundle. engine.ts keeps thin async wrappers that dynamically import this module on first
// use; the dynamic import is the code-split boundary. Each function is standalone, taking
// the engine's core and store (plus a disposed guard and, for the propagator path, a small
// mutable TLE-state ref) as parameters, so nothing here depends on the BesselEngine class.

import { computeElevationAccess, type Facility } from '@bessel/access';
import { figureOfMerit, walkerConstellation, sweepCoverageGrid, type GridSpec } from '@bessel/coverage';
import { CoverageOverlayError, type CoverageOverlayCell, type Km3 } from '@bessel/scene';
import { windowIntersect } from '@bessel/timeline';
import { linkBudget } from '@bessel/rf';
import { closestApproachLinear, collisionProbability2D } from '@bessel/conjunction';
import { eigenAxisSlew, nadirAttitude, sunPointingAttitude, type Quaternion } from '@bessel/attitude';
import { lambert } from '@bessel/mission';
import { writeOem, type Oem } from '@bessel/interop';
import {
  parseTle,
  sgp4init,
  sgp4,
  publishEphemeris,
  emptyTable,
  propagateCowell,
  type ClassicalElements,
  type EphemerisTable,
} from '@bessel/propagator';
import {
  coverageMetric,
  meanMotion,
  metricScalars,
  summarizeCoverage,
  walkerSemiMajorAxisKm,
  walkerStateAt,
  type CoverageMetricId,
} from './coverage-metric.ts';
import { downloadBlob } from '@bessel/ui';
import { describeProvider, type ProviderKind, type ProviderSpec, type SpiceEngine } from '@bessel/spice';
import { SAMPLE_TLE } from '../sample-tle.ts';
import { RAD2DEG, DEG2RAD } from '../angles.ts';
import {
  DEFAULT_LINK,
  DEFAULT_CONJUNCTION,
  DEFAULT_CONSTELLATION,
  DEFAULT_SLEW,
  type SlewPointing,
  type ConstellationParams,
} from './analysis-defaults.ts';
export { DEFAULT_CONSTELLATION };
export type { SlewPointing, ConstellationParams };
// Re-export the per-domain Access-tab ops so the engine reaches them through this same lazy
// chunk: a single dynamic-import boundary keeps one copy of the @bessel/access geometry-finder
// reduction in the lazy analysis bundle instead of duplicating it across two chunks.
export { computeAccessStack, computeFovWindows } from './ops-access.ts';
import type { AppStore } from '../store/index.ts';
import type { EngineCore } from './bootstrap.ts';
import { buildHpopForceModel, HPOP_FORCE_MODEL_LABELS, type HpopForceModel } from './hpop-model.ts';
import { runMcsDesign as runMcsDesignCore, type McsDesign } from './mcs.ts';
import { runOdDemo } from './od.ts';
import { centerMu } from './center-mu.ts';
import { ScreeningClient, ScreeningCancelled } from '../screening-client.ts';
import { buildSyntheticCatalog, SYNTHETIC_SCREEN_DEFAULTS } from '../synthetic-catalog.ts';
import { reduceScreening, INITIAL_SCREENING } from '../screening-protocol.ts';

// Earth gravity constants for the numerical (HPOP) propagation. Published WGS-84/EGM
// values, caller-injected because a PCK carries no GM or harmonics.
const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;
const EARTH_J2 = 1.08262668e-3;

/** The pointing references a slew can target, each resolving to a J2000->body attitude
 *  matrix at an epoch. A registry (not a ternary) so a new mode is one entry. */
const SLEW_POINTING: Record<
  SlewPointing,
  {
    readonly resolve: (spice: SpiceEngine, observer: string, body: string, et: number) => Promise<readonly number[]>;
    readonly label: string;
  }
> = {
  nadir: { resolve: nadirAttitude, label: 'nadir' },
  sun: { resolve: sunPointingAttitude, label: 'Sun' },
};

/** Optional time-span override (seconds) for a span-based analysis tool. */
export interface AnalysisSpan {
  readonly spanSec?: number;
  readonly stepSec?: number;
}

/** A span override plus an optional target object (for range/access). */
export interface AnalysisTargetSpan extends AnalysisSpan {
  readonly target?: string;
}

/** A span override plus the downlink-radio parameters of the link budget. */
export interface LinkBudgetOpts extends AnalysisSpan {
  readonly eirpDbW?: number;
  readonly freqHz?: number;
  readonly gOverTDbK?: number;
  readonly dataRateBps?: number;
}

/** Conjunction encounter parameters: the secondary object and the assumed 2D covariance. */
export interface ConjunctionOpts {
  readonly secondary?: string;
  /** Per-axis position sigma (km) of the assumed encounter covariance. */
  readonly sigmaKm?: number;
  /** Combined hard-body radius (km). */
  readonly radiusKm?: number;
}

/** Eigen-axis slew parameters: the from/to pointing references and the slew dynamics. */
export interface SlewOpts {
  readonly fromMode?: SlewPointing;
  readonly toMode?: SlewPointing;
  readonly maxRateDeg?: number;
  readonly maxAccelDeg?: number;
}

/** A data-provider workbench request: a provider over an observer/target pair + grid. */
export interface ReportConfig {
  readonly kind: ProviderKind;
  readonly observer: string;
  readonly target: string;
  readonly frame: string;
  readonly durationS: number;
  readonly stepS: number;
}

/** The most recently propagated satellite (NAIF id + epoch), for ground-station access.
 * Held as a mutable ref on the engine so the TLE-propagation ops can update it and the
 * station-access op can read it across separate dynamic-import calls. */
export interface TleState {
  seq: number;
  last: { bodyId: number; epoch: number } | null;
}

/** The live dedicated-screening worker client, held as a mutable ref on the engine so the
 *  (lazily imported) screening ops can start and cancel a run across separate dynamic-import
 *  calls. Null until the first screen constructs the client. */
export interface ScreeningRef {
  client: ScreeningClient | null;
}

/** Build a concrete ProviderSpec from a report config (only frame-needing kinds use it). */
function providerFromConfig(cfg: ReportConfig): ProviderSpec {
  const { observer, target, frame } = cfg;
  switch (cfg.kind) {
    case 'range':
      return { kind: 'range', observer, target };
    case 'rangeRate':
      return { kind: 'rangeRate', observer, target };
    case 'speed':
      return { kind: 'speed', observer, target, frame };
    case 'position':
      return { kind: 'position', observer, target, frame };
    case 'velocity':
      return { kind: 'velocity', observer, target, frame };
    case 'subPointLonLat':
      return { kind: 'subPointLonLat', observer, target, frame };
  }
}

/**
 * Range analysis: sample the spacecraft-to-center-body distance (km) over one day
 * from the current epoch and store it as a time series for the analysis chart.
 * Uses the batched spkpos path (one worker round-trip for all samples). Requires a
 * loaded spacecraft mission.
 */
export async function computeRange(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisTargetSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ rangeSeries: null });
    return;
  }
  const target = opts.target ?? body;
  const t0 = e.clock.state.et;
  try {
    // F3: one cancellable evalSeries job computes the range column over the grid in
    // a single worker round-trip (the interpreter reduces position to range in the
    // worker), instead of shipping n*3 coordinates back to be reduced here.
    const series = await e.spice.evalSeries({
      grid: { start: t0, stop: t0 + (opts.spanSec ?? 86400), step: opts.stepSec ?? 360 },
      providers: [{ kind: 'range', observer: sc, target }],
    });
    if (!isDisposed()) {
      store.setState({
        rangeSeries: { et: series.et, value: series.columns[0]!, label: `${sc} to ${target} (km)` },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ rangeSeries: null });
    console.error('range analysis failed', err);
    throw err;
  }
}

/**
 * Communications analysis: downlink Eb/N0 (dB) from the spacecraft to Earth over
 * one day, combining the geometric range (batched spkpos) with the @bessel/rf
 * link-budget physics for a representative DSN 34 m X-band station. Plotted as a
 * time series. Requires a spacecraft mission.
 */
export async function computeLinkBudget(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: LinkBudgetOpts = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  if (!sc) {
    store.setState({ linkSeries: null });
    return;
  }
  const t0 = e.clock.state.et;
  const spanSec = opts.spanSec ?? 86400;
  // Downlink radio parameters: a representative Cassini X-band link to a DSN 34 m
  // station by default, overridable from the panel.
  const eirpDbW = opts.eirpDbW ?? DEFAULT_LINK.eirpDbW;
  const freqHz = opts.freqHz ?? DEFAULT_LINK.freqHz;
  const gOverTDbK = opts.gOverTDbK ?? DEFAULT_LINK.gOverTDbK;
  const dataRateBps = opts.dataRateBps ?? DEFAULT_LINK.dataRateBps;
  const samples = 240;
  const et = new Float64Array(samples);
  for (let i = 0; i < samples; i++) et[i] = t0 + (i / (samples - 1)) * spanSec;
  try {
    // Earth relative to the spacecraft at each epoch, reduced to a downlink range.
    const xyz = await e.spice.spkposBatch('EARTH', et, 'J2000', 'NONE', sc);
    const ebN0 = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const distanceKm = Math.hypot(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!);
      ebN0[i] = linkBudget({ eirpDbW, distanceKm, freqHz, gOverTDbK, dataRateBps }).ebN0Db;
    }
    if (!isDisposed()) {
      store.setState({
        linkSeries: { et, value: ebN0, label: `${sc} to Earth Eb/N0 (dB)` },
        linkParams: { eirpDbW, freqHz, gOverTDbK, dataRateBps },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ linkSeries: null });
    console.error('link-budget analysis failed', err);
    throw err;
  }
}

// The line-of-sight access run and the nadir-pointed in-FOV sweep moved to the per-domain
// ops-access.ts (analysis-UX Phase 1), where they are generalized to a composable constraint
// stack and a selectable boresight pointing mode. Keeping them out of this module also keeps a
// second copy of the @bessel/access geometry-finder reduction out of this chunk.

/**
 * Conjunction analysis: rectilinear closest approach of the center body relative to
 * the spacecraft from the current epoch, plus a 2D probability of collision under an
 * assumed encounter covariance (@bessel/conjunction). A demonstration of the close-
 * approach + Pc math on the loaded pair. Requires a spacecraft mission.
 */
export async function computeConjunction(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: ConjunctionOpts = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ conjunction: null });
    return;
  }
  const secondary = opts.secondary ?? body;
  // Encounter covariance: per-axis position sigma and combined hard-body radius,
  // overridable from the panel (defaults 1 km sigma, 100 m radius).
  const sigmaKm = opts.sigmaKm ?? DEFAULT_CONJUNCTION.sigmaKm;
  const radiusKm = opts.radiusKm ?? DEFAULT_CONJUNCTION.radiusKm;
  const et = e.clock.state.et;
  try {
    const rel = await e.spice.spkezr(secondary, et, 'J2000', 'NONE', sc);
    const ca = closestApproachLinear(rel.position, rel.velocity);
    // The miss projected onto two encounter-plane axes under the assumed covariance.
    const pc = collisionProbability2D({
      radiusKm,
      sigmaXKm: sigmaKm,
      sigmaYKm: sigmaKm,
      missXKm: ca.missKm,
      missYKm: 0,
    });
    if (!isDisposed()) {
      store.setState({
        conjunction: {
          tcaSec: ca.tca,
          missKm: ca.missKm,
          relSpeedKmS: ca.relSpeedKmS,
          pc,
          sigmaKm,
          radiusKm,
          label: `${sc} vs ${secondary}`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ conjunction: null });
    console.error('conjunction analysis failed', err);
    throw err;
  }
}

/**
 * All-vs-all catalog screen on a DEDICATED screening worker. Builds the deterministic
 * synthetic catalog at the current epoch (real RSO ingestion is out of scope), hands it to
 * the worker through the ScreeningClient, and folds the worker's incremental progress and
 * terminal result into the screening slice through the pure reduceScreening reducer (so the
 * panel shows a moving progress readout and then the flagged events). The main thread never
 * runs screenAllVsAll itself, so a multi-object screen does not stall rendering. A user
 * cancel terminates the worker; that surfaces as ScreeningCancelled, which resets the slice
 * to idle rather than raising a loud error.
 */
export async function screenCatalog(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  ref: ScreeningRef,
): Promise<void> {
  const epochEt = e.clock.state.et;
  const objects = buildSyntheticCatalog({
    epochEt,
    spanSec: SYNTHETIC_SCREEN_DEFAULTS.spanSec,
    steps: SYNTHETIC_SCREEN_DEFAULTS.steps,
  });
  const client = ref.client ?? (ref.client = new ScreeningClient());
  // Open the run: a zeroed bar over the partition count (one per primary object), recording the
  // catalog epoch so the panel can show each flagged TCA relative to it (ConjunctionEvent.tca is
  // absolute ET, the synthetic grid starts at this epoch).
  store.setState((s) => ({
    screening: reduceScreening(s.screening, { kind: 'start', total: objects.length - 1, epoch: epochEt }),
  }));
  try {
    const events = await client.start(
      { objects, thresholdKm: SYNTHETIC_SCREEN_DEFAULTS.thresholdKm, padKm: SYNTHETIC_SCREEN_DEFAULTS.padKm },
      (p) => {
        if (!isDisposed()) {
          store.setState((s) => ({ screening: reduceScreening(s.screening, p) }));
        }
      },
    );
    if (!isDisposed()) {
      store.setState((s) => ({ screening: reduceScreening(s.screening, { kind: 'result', events }) }));
    }
  } catch (err) {
    // A user cancel (worker terminated) is not a failure: reset the slice to idle.
    if (err instanceof ScreeningCancelled) {
      if (!isDisposed()) store.setState({ screening: INITIAL_SCREENING });
      return;
    }
    if (!isDisposed()) {
      const message = err instanceof Error ? err.message : String(err);
      store.setState((s) => ({ screening: reduceScreening(s.screening, { kind: 'error', message }) }));
    }
    console.error('catalog screen failed', err);
    throw err;
  }
}

/** Cancel an in-flight catalog screen: terminate the worker and reset the screening slice. */
export function cancelScreen(store: AppStore, ref: ScreeningRef): void {
  ref.client?.cancel();
  store.setState((s) => ({ screening: reduceScreening(s.screening, { kind: 'cancel' }) }));
}


/**
 * Attitude analysis: an eigen-axis slew from a nadir-pointing to a sun-pointing
 * attitude at the current epoch, honoring a max rate and acceleration, sampled as a
 * slew-angle (deg) time series (@bessel/attitude). Requires a spacecraft mission.
 */
export async function computeSlew(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: SlewOpts = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ slewSeries: null });
    return;
  }
  const fromMode = opts.fromMode ?? DEFAULT_SLEW.fromMode;
  const toMode = opts.toMode ?? DEFAULT_SLEW.toMode;
  const maxRateRad = (opts.maxRateDeg ?? DEFAULT_SLEW.maxRateDeg) * DEG2RAD;
  const maxAccelRad = (opts.maxAccelDeg ?? DEFAULT_SLEW.maxAccelDeg) * DEG2RAD;
  const et = e.clock.state.et;
  const from = SLEW_POINTING[fromMode];
  const to = SLEW_POINTING[toMode];
  try {
    const [fromM, toM] = await Promise.all([
      from.resolve(e.spice, sc, body, et),
      to.resolve(e.spice, sc, body, et),
    ]);
    const a0 = await e.spice.m2q(fromM);
    const a1 = await e.spice.m2q(toM);
    const q0: Quaternion = [a0[0]!, a0[1]!, a0[2]!, a0[3]!];
    const q1: Quaternion = [a1[0]!, a1[1]!, a1[2]!, a1[3]!];
    const slew = eigenAxisSlew(q0, q1, maxRateRad, maxAccelRad);
    const samples = 120;
    const t = new Float64Array(samples);
    const angleDeg = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      // A zero-duration slew (from === to) collapses to a single point; guard the div.
      const ti = slew.duration > 0 ? (i / (samples - 1)) * slew.duration : 0;
      const q = slew.at(ti);
      const dotAbs = Math.abs(q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]);
      t[i] = ti;
      angleDeg[i] = 2 * Math.acos(Math.min(1, dotAbs)) * RAD2DEG;
    }
    if (!isDisposed()) {
      store.setState({
        slewSeries: { et: t, value: angleDeg, label: `${sc} ${from.label}->${to.label} slew (deg)` },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ slewSeries: null });
    console.error('slew analysis failed', err);
    throw err;
  }
}

/**
 * Maneuver design: solve a Lambert transfer (@bessel/mission) from the spacecraft's
 * current position about the center body to a target point a quarter-revolution
 * ahead in the orbit plane, over a quarter of the circular period at that radius,
 * and report the departure delta-v relative to the current velocity. The 90 deg
 * geometry keeps the boundary-value problem well posed for any arc (including a
 * hyperbolic flyby). Requires a spacecraft mission and the center body's GM.
 */
export async function computeTransfer(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ transfer: null });
    return;
  }
  const mu = await centerMu(e, body);
  if (mu === null) {
    store.setState({ transfer: null });
    return;
  }
  const et = e.clock.state.et;
  try {
    const s1 = await e.spice.spkezr(sc, et, 'J2000', 'NONE', body);
    const r = s1.position;
    const v = s1.velocity;
    const rMag = Math.hypot(r.x, r.y, r.z);
    // Orbit normal (unit), then the target a quarter turn ahead at the same radius.
    const nx = r.y * v.z - r.z * v.y;
    const ny = r.z * v.x - r.x * v.z;
    const nz = r.x * v.y - r.y * v.x;
    const nMag = Math.hypot(nx, ny, nz) || 1;
    const un = { x: nx / nMag, y: ny / nMag, z: nz / nMag };
    // r2 = n x r (a 90 deg in-plane rotation of r about the orbit normal).
    const r2 = {
      x: un.y * r.z - un.z * r.y,
      y: un.z * r.x - un.x * r.z,
      z: un.x * r.y - un.y * r.x,
    };
    const tofSec = (Math.PI / 2) * Math.sqrt(rMag ** 3 / mu); // quarter circular period
    const sol = lambert(r, r2, tofSec, mu);
    const dv = Math.hypot(sol.v1.x - v.x, sol.v1.y - v.y, sol.v1.z - v.z);
    if (!isDisposed()) {
      store.setState({
        transfer: { deltaVKmS: dv, tofHours: tofSec / 3600, label: `${sc} Lambert arc` },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ transfer: null });
    console.error('transfer analysis failed', err);
    throw err;
  }
}

/**
 * Ground-track analysis: the sub-spacecraft longitude/latitude over one day in the
 * center body's body-fixed frame, for the 2D map overlay (@bessel/ui GroundTrackMap;
 * the projection is equirectangular). Requires a spacecraft mission.
 */
export async function computeGroundTrack(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ groundTrack: null });
    return;
  }
  const t0 = e.clock.state.et;
  try {
    // F3: one evalSeries job returns the sub-spacecraft longitude/latitude (radians)
    // in the body-fixed frame; @bessel/ui GroundTrackMap projects it via
    // @bessel/map-projection. No ad hoc lon/lat math in the app.
    const series = await e.spice.evalSeries({
      grid: { start: t0, stop: t0 + (opts.spanSec ?? 86400), step: opts.stepSec ?? 240 },
      providers: [
        { kind: 'subPointLonLat', observer: body, target: sc, frame: `IAU_${body.toUpperCase()}` },
      ],
    });
    if (!isDisposed()) {
      store.setState({
        groundTrack: {
          et: series.et,
          lon: series.columns[0]!,
          lat: series.columns[1]!,
          label: `${sc} ground track`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ groundTrack: null });
    console.error('ground-track analysis failed', err);
    throw err;
  }
}

/**
 * Interoperability: export the spacecraft's trajectory over the loaded window as a
 * CCSDS OEM (KVN) document (@bessel/interop writeOem) and download it. Requires a
 * spacecraft mission.
 */
export async function exportOem(e: EngineCore, store: AppStore): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) return;
  const [t0, t1] = store.getState().bounds;
  const samples = 25;
  try {
    const states = await Promise.all(
      Array.from({ length: samples }, async (_unused, i) => {
        const et = t0 + (i / (samples - 1)) * (t1 - t0);
        const s = await e.spice.spkezr(sc, et, 'J2000', 'NONE', body);
        const epoch = await e.spice.et2utc(et, 'ISOC', 3);
        return {
          epoch: `${epoch}Z`,
          position: [s.position.x, s.position.y, s.position.z] as [number, number, number],
          velocity: [s.velocity.x, s.velocity.y, s.velocity.z] as [number, number, number],
        };
      }),
    );
    const oem: Oem = {
      version: '2.0',
      metadata: {
        objectName: sc,
        centerName: body.toUpperCase(),
        refFrame: 'ICRF',
        timeSystem: 'UTC',
        startTime: states[0]!.epoch,
        stopTime: states[states.length - 1]!.epoch,
      },
      states,
    };
    const blob = new Blob([writeOem(oem)], { type: 'text/plain' });
    downloadBlob(blob, `${sc.toLowerCase()}.oem`);
  } catch (err) {
    console.error('OEM export failed', err);
    throw err;
  }
}

/**
 * Propagation: parse the bundled sample TLE, run SGP4 over one day from its epoch,
 * publish the arc as an in-memory SPK Type-13 segment about the Earth, then query
 * that SPK through the F3 evalSeries pipeline for an altitude time series and a
 * ground track. This exercises the full @bessel/propagator path (TLE -> SGP4 ->
 * SPK-13 -> render) with no special-case geometry: the propagated orbit is read
 * back through the same spkpos pipeline as any other body. (Frame note: SGP4 is in
 * TEME; the segment is published as J2000, an arcminute-scale approximation near the
 * epoch. The EOP-aware TEME->J2000 conversion is the interop/frame work, #22.)
 */
export async function propagateTle(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  tle: TleState,
): Promise<void> {
  try {
    const parsed = parseTle(SAMPLE_TLE.line1, SAMPLE_TLE.line2);
    const rec = sgp4init(parsed);
    // SPICE str2et rejects a trailing 'Z'; the TLE epoch is UTC regardless.
    const epoch = await e.spice.str2et(parsed.epochUtc.replace(/Z$/, ''));
    const step = 60;
    const n = Math.floor(86400 / step) + 1;
    const et = new Float64Array(n);
    for (let i = 0; i < n; i++) et[i] = epoch + i * step;
    const table = emptyTable('J2000', et);
    for (let i = 0; i < n; i++) {
      const s = sgp4(rec, (et[i]! - epoch) / 60); // SGP4 tsince is in minutes
      (table.x as Float64Array)[i] = s.position[0];
      (table.y as Float64Array)[i] = s.position[1];
      (table.z as Float64Array)[i] = s.position[2];
      (table.vx as Float64Array)[i] = s.velocity[0];
      (table.vy as Float64Array)[i] = s.velocity[1];
      (table.vz as Float64Array)[i] = s.velocity[2];
    }
    const bodyId = -(990000 + tle.seq++);
    await publishEphemeris(e.spice, table, {
      name: `tle${-bodyId}.bsp`,
      body: bodyId,
      center: 399,
      degree: 7,
    });
    tle.last = { bodyId, epoch };
    const radii = await e.spice.bodvrd('EARTH', 'RADII').catch(() => [6378.137]);
    const re = radii[0] ?? 6378.137;
    const series = await e.spice.evalSeries({
      grid: { et },
      providers: [
        { kind: 'range', observer: '399', target: String(bodyId) },
        { kind: 'subPointLonLat', observer: '399', target: String(bodyId), frame: 'IAU_EARTH' },
      ],
    });
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) altitude[i] = series.columns[0]![i]! - re;
    if (!isDisposed()) {
      store.setState({
        tleOrbit: {
          altitude: { et, value: altitude, label: `${SAMPLE_TLE.name} altitude (km)` },
          track: { et, lon: series.columns[1]!, lat: series.columns[2]!, label: `${SAMPLE_TLE.name} ground track` },
          periodMin: 1440 / parsed.meanMotion,
          label: SAMPLE_TLE.name,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ tleOrbit: null });
    console.error('TLE propagation failed', err);
    throw err;
  }
}

/**
 * Ground-station access: passes of the last-propagated satellite over a
 * Goldstone-class station for one day, as the composition of two constraints from
 * the access library, above a 10 deg elevation mask (computeElevationAccess) AND
 * within a geocentric range gate (gfdist), intersected with the window algebra.
 * Both constraints resolve against the published satellite SPK alone, so this needs
 * no planetary ephemeris. Requires a prior TLE propagation. (STK §4.3.)
 */
export async function computeStationAccess(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  tle: TleState,
): Promise<void> {
  const last = tle.last;
  if (!last) {
    store.setState({ stationAccess: null });
    return;
  }
  const target = String(last.bodyId);
  const facility: Facility = {
    body: 'EARTH',
    bodyFrame: 'IAU_EARTH',
    lonRad: -116.89 * DEG2RAD,
    latRad: 35.426 * DEG2RAD,
    altKm: 1.0,
  };
  // A 12 hour span at a 2 minute step keeps the per-epoch elevation sweep responsive
  // (passes are far longer than the step); the range gate uses the same cadence.
  const span: [number, number] = [last.epoch, last.epoch + 43200];
  const maxRangeKm = 9000;
  try {
    // Elevation-mask access intersected with a geocentric range gate: two composed
    // constraints (the elevation finder and the gfdist distance finder).
    const elevation = await computeElevationAccess(e.spice, facility, target, span, 120, 10 * DEG2RAD);
    const inRange = await e.spice.gfdist(target, 'NONE', '399', '<', maxRangeKm, 120, span[0], span[1]);
    const visible = windowIntersect(elevation, inRange);
    const fom = figureOfMerit(visible, span);
    if (!isDisposed()) {
      store.setState({
        stationAccess: {
          window: visible,
          span,
          fom: {
            percentCoverage: fom.percentCoverage,
            accessCount: fom.accessCount,
            maxGapSec: fom.maxGapSec,
          },
          label: `Goldstone passes (>10 deg, <${maxRangeKm} km)`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ stationAccess: null });
    console.error('station access failed', err);
    throw err;
  }
}

/**
 * Numerical (HPOP) propagation: take the TLE's initial osculating state, integrate
 * it over one day with the native Cowell propagator under a point-mass + J2 force
 * model (@bessel/propagator), publish the arc as an SPK, and plot its altitude. This
 * is the analytic-vs-numerical companion to the SGP4 run and exercises the new
 * integrator end-to-end. (Frame note: the TLE state is TEME, integrated as J2000, an
 * arcminute-scale approximation near the epoch; the J2 axis assumption holds.)
 */
export async function propagateHpop(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  tle: TleState,
  model: HpopForceModel = 'j2',
): Promise<void> {
  try {
    const parsed = parseTle(SAMPLE_TLE.line1, SAMPLE_TLE.line2);
    const rec = sgp4init(parsed);
    const epoch = await e.spice.str2et(parsed.epochUtc.replace(/Z$/, ''));
    const s0 = sgp4(rec, 0); // TEME state at the TLE epoch
    const step = 60;
    const n = Math.floor(86400 / step) + 1;
    const et = new Float64Array(n);
    for (let i = 0; i < n; i++) et[i] = epoch + i * step;
    const forceModel = buildHpopForceModel(model, { gm: EARTH_GM, re: EARTH_RE, j2: EARTH_J2 });
    const table = propagateCowell({
      state: {
        position: { x: s0.position[0], y: s0.position[1], z: s0.position[2] },
        velocity: { x: s0.velocity[0], y: s0.velocity[1], z: s0.velocity[2] },
      },
      epoch,
      etGrid: et,
      forceModel,
    });
    const bodyId = -(995000 + tle.seq++);
    await publishEphemeris(e.spice, table, { name: `hpop${-bodyId}.bsp`, body: bodyId, center: 399, degree: 7 });
    const series = await e.spice.evalSeries({
      grid: { et },
      providers: [{ kind: 'range', observer: '399', target: String(bodyId) }],
    });
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) altitude[i] = series.columns[0]![i]! - EARTH_RE;
    if (!isDisposed()) {
      store.setState({
        hpopAltitude: {
          et,
          value: altitude,
          label: `${SAMPLE_TLE.name} HPOP altitude (km, ${HPOP_FORCE_MODEL_LABELS[model]})`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ hpopAltitude: null });
    console.error('HPOP propagation failed', err);
    throw err;
  }
}

/**
 * Mission-design workbench: assemble a small Mission Control Sequence (initial state,
 * a coast, an impulsive maneuver, then a Target whose differential corrector tunes the
 * burn to reach a desired radius) and run it SPICE-free via @bessel/propagator. The
 * resulting Earth-centered arc is drawn as an orbit polyline (camera-relative, km
 * scaled in the scene), and the final state plus the differential-corrector report are
 * written to the store. (STK_PARITY_SPEC §4.3.)
 */
export async function runMcsDesign(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  design: McsDesign,
): Promise<void> {
  try {
    const { result, arc } = await runMcsDesignCore(design);
    if (isDisposed()) return;
    // Render the propagated arc as an Earth-anchored orbit polyline. The points are km
    // (Earth-centered J2000); the scene applies the camera-relative scale, so no raw
    // solar-system coordinates reach the GPU float32 buffers.
    if (arc.length >= 2) {
      e.scene.setOrbits([{ id: 'mcs-arc', anchorBody: 'Earth', points: arc, color: 0xffaa33 }]);
    }
    store.setState({ mcsResult: result });
  } catch (err) {
    if (!isDisposed()) store.setState({ mcsResult: null });
    console.error('MCS design run failed', err);
    throw err;
  }
}

/**
 * Orbit-determination workbench: synthesize a small range / range-rate / angles
 * measurement set from a known truth orbit, perturb the initial guess, and recover the
 * state with @bessel/od batch least squares. SPICE-free and synchronous; writes the
 * estimate, residual RMS, and covariance summary to the store. (Tapley-Schutz-Born
 * §4.3; Vallado §10.2.)
 */
export function runOd(store: AppStore, isDisposed: () => boolean, noiseScale: number): void {
  try {
    const result = runOdDemo(noiseScale);
    if (!isDisposed()) store.setState({ odResult: result });
  } catch (err) {
    if (!isDisposed()) store.setState({ odResult: null });
    console.error('Orbit determination failed', err);
    throw err;
  }
}

/**
 * Data-provider workbench: evaluate any registered provider (range, position, sub-
 * point, ...) for an observer/target pair over a time grid in one F3 evalSeries job,
 * and build a unit-tagged report table (downsampled for display, full series kept
 * for CSV). This is the configurable generalization of the fixed analysis buttons.
 * (STK_PARITY_SPEC §4.10.)
 */
export async function runReport(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  cfg: ReportConfig,
): Promise<void> {
  const desc = describeProvider(cfg.kind);
  const t0 = e.clock.state.et;
  const provider = providerFromConfig(cfg);
  try {
    const series = await e.spice.evalSeries({
      grid: { start: t0, stop: t0 + cfg.durationS, step: cfg.stepS },
      providers: [provider],
    });
    const n = series.et.length;
    const headers = ['UTC', ...series.names.map((nm) => `${nm} (${desc.unit})`)];
    // Downsample to at most ~25 display rows and label them with UTC.
    const maxDisplay = 25;
    const stride = Math.max(1, Math.ceil(n / maxDisplay));
    const idx: number[] = [];
    for (let i = 0; i < n; i += stride) idx.push(i);
    const utc = await Promise.all(idx.map((i) => e.spice.et2utc(series.et[i]!, 'ISOC', 1)));
    const rows = idx.map((i, j) => [utc[j]!, ...series.columns.map((c) => c[i]!)]);
    if (!isDisposed()) {
      store.setState({
        report: {
          headers,
          rows,
          series: { et: series.et, columns: series.columns, names: series.names },
          label: `${desc.label}: ${cfg.observer} to ${cfg.target}`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ report: null });
    console.error('report failed', err);
    throw err;
  }
}

// COVERAGE & CONSTELLATION: the connected Walker -> sweep -> metric-aware contour workflow.
// designConstellation generates a Walker element set, publishes each satellite as an SPK ASSET
// (analytic circular two-body states, one SPK write per satellite, no per-epoch worker calls),
// renders one orbit ring per plane (camera-relative, @bessel/scene stays SPICE-free), and stores
// the asset id set the sweep reads. sweepCoverage sweeps that asset set over a configurable grid
// and colors the draped overlay by the SELECTED figure-of-merit metric, writing the regional FOM
// summary. Kept in this lazy chunk (alongside the other analysis ops) so the heavy @bessel work
// stays behind the engine's dynamic-import seam and the deps are shared, not fragmented.

const EARTH_NAIF = 399;
// Color palette for the per-plane orbit rings (cycled by plane index).
const RING_COLORS = [0x33ccff, 0xffaa33, 0x66ff99, 0xff66cc, 0xffff66, 0x99aaff] as const;

/** The most recently designed constellation: a sequence counter so each design run gets fresh
 *  asset SPK ids, and the published asset id list the sweep covers over. A mutable ref on the
 *  engine so the design and sweep ops share it across separate dynamic-import calls. */
export interface ConstellationRef {
  seq: number;
  assetIds: string[];
}

/** The coverage sweep settings the panel form drives (grid resolution, region, metric, k). */
export interface CoverageSweepOpts {
  readonly spanSec?: number;
  readonly stepSec?: number;
  /** Grid resolution: latitude rows and longitude columns. */
  readonly latCount?: number;
  readonly lonCount?: number;
  /** Region bounds (degrees); default global. */
  readonly latMinDeg?: number;
  readonly latMaxDeg?: number;
  readonly lonMinDeg?: number;
  readonly lonMaxDeg?: number;
  /** The figure-of-merit metric to color the contour by. */
  readonly metric?: CoverageMetricId;
  /** The N-fold order k (>= k simultaneous assets), 1-based. */
  readonly nFoldK?: number;
  /** Minimum elevation mask (degrees) for a cell to see an asset. */
  readonly minElevationDeg?: number;
}

/**
 * Build a circular two-body ephemeris table for one Walker satellite over an ET grid,
 * analytically (no SPICE round-trip per epoch): for e = 0 the satellite moves at constant
 * radius a and angular rate n = sqrt(mu / a^3), so the perifocal position/velocity is a
 * rotating constant-magnitude vector, rotated into J2000 by the inclination then RAAN. This
 * keeps publishing the whole asset set to one SPK write per satellite. Pure (delegates the
 * rotation to the tested walkerStateAt kernel).
 */
function walkerSatTable(el: ClassicalElements, mu: number, etGrid: Float64Array): EphemerisTable {
  const table = emptyTable('J2000', etGrid);
  const n = meanMotion(el.a, mu); // e = 0, so the mean motion is the true angular rate
  const x = table.x as Float64Array;
  const y = table.y as Float64Array;
  const z = table.z as Float64Array;
  const vx = table.vx as Float64Array;
  const vy = table.vy as Float64Array;
  const vz = table.vz as Float64Array;
  for (let k = 0; k < etGrid.length; k++) {
    const { pos, vel } = walkerStateAt(el, n, el.m0 + el.argp + n * (etGrid[k]! - el.epoch));
    x[k] = pos[0];
    y[k] = pos[1];
    z[k] = pos[2];
    vx[k] = vel[0];
    vy[k] = vel[1];
    vz[k] = vel[2];
  }
  return table;
}

/**
 * Design a Walker constellation AND make it the swept asset set: generate the T/P/F element
 * set, publish each satellite as an in-memory SPK segment (a queryable asset, the same path as
 * TLE propagation), render one orbit ring per plane in the scene (camera-relative), and store
 * the asset id set + structure. The designed members then feed the coverage sweep through the
 * store. Earth-centered; fails loud on a non-buildable T/P (walkerConstellation throws).
 */
export async function designConstellation(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  ref: ConstellationRef,
  params: ConstellationParams,
): Promise<void> {
  const { totalSats, planes, phasing, inclinationDeg, altitudeKm, pattern } = params;
  const a = walkerSemiMajorAxisKm(altitudeKm);
  const epoch = e.clock.state.et;
  const elements: ClassicalElements[] = walkerConstellation({
    a,
    e: 0,
    i: inclinationDeg * DEG2RAD,
    argp: 0,
    totalSats,
    planes,
    phasing,
    pattern,
    epoch,
  });
  try {
    // Publish each satellite as an SPK over a day-long arc so the sweep can query it; states
    // are analytic (circular two-body), so the only worker round-trip is one SPK write per sat.
    const step = 120; // dense enough for the Type-13 Hermite fit of a ~90 min LEO orbit
    const n = Math.floor(86400 / step) + 1;
    const et = new Float64Array(n);
    for (let i = 0; i < n; i++) et[i] = epoch + i * step;
    const design = ++ref.seq;
    const assetIds: string[] = [];
    for (let s = 0; s < elements.length; s++) {
      if (isDisposed()) return;
      const bodyId = -(970000 + design * 1000 + s);
      const table = walkerSatTable(elements[s]!, EARTH_GM, et);
      await publishEphemeris(e.spice, table, {
        name: `walker${design}_${s}.bsp`,
        body: bodyId,
        center: EARTH_NAIF,
        degree: 7,
      });
      assetIds.push(String(bodyId));
    }
    if (isDisposed()) return;
    ref.assetIds = assetIds;
    // One camera-relative orbit ring per plane: a full revolution of the first satellite in
    // each plane, sampled from the shared circular state kernel (all sats in a plane share it).
    const perPlaneCount = Math.max(1, Math.floor(elements.length / planes));
    const ringSamples = 96;
    const orbits = [];
    for (let p = 0; p < planes; p++) {
      const el = elements[p * perPlaneCount];
      if (!el) continue;
      const points: Km3[] = [];
      for (let r = 0; r <= ringSamples; r++) {
        points.push(walkerStateAt(el, 0, (2 * Math.PI * r) / ringSamples).pos);
      }
      orbits.push({ id: `walker-plane-${p}`, anchorBody: 'Earth', points, color: RING_COLORS[p % RING_COLORS.length]! });
    }
    e.scene.setOrbits(orbits);
    const perPlane = elements.length / planes;
    store.setState({
      constellation: { totalSats: elements.length, planes, perPlane, pattern, phasing, inclinationDeg, altitudeKm },
      designedConstellation: { assetIds, totalSats: elements.length, planes, perPlane },
    });
  } catch (err) {
    if (!isDisposed()) store.setState({ designedConstellation: null });
    console.error('constellation design failed', err);
    throw err;
  }
}

/**
 * Sweep the coverage grid over the designed asset set (or the loaded spacecraft when no
 * constellation has been designed), color the draped overlay by the SELECTED figure-of-merit
 * metric (not just percentCoverage), and write the regional FOM summary. The grid resolution
 * and region come from the form; the metric->[0,1] colormap mapping is the pure metricScalars.
 * Requires a center body in the ephemeris table to anchor the overlay (fails loud otherwise).
 */
export async function sweepCoverage(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  ref: ConstellationRef,
  opts: CoverageSweepOpts = {},
): Promise<void> {
  const body = e.identity.centerBody ?? 'EARTH';
  // The asset set: the designed constellation members, else the loaded spacecraft.
  const assets =
    ref.assetIds.length > 0 ? ref.assetIds : e.identity.spacecraftName ? [e.identity.spacecraftName] : [];
  if (assets.length === 0) {
    e.scene.clearCoverageOverlay();
    store.setState({ coverageGrid: null });
    return;
  }
  const bodyFrame = `IAU_${body.toUpperCase()}`;
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
  const metric = coverageMetric(opts.metric ?? 'percentCoverage');
  const k = Math.max(1, Math.floor(opts.nFoldK ?? 1));
  const grid: GridSpec = {
    body,
    bodyFrame,
    latMin: (opts.latMinDeg ?? -85) * DEG2RAD,
    latMax: (opts.latMaxDeg ?? 85) * DEG2RAD,
    latCount: Math.max(1, Math.floor(opts.latCount ?? 9)),
    lonMin: (opts.lonMinDeg ?? -180) * DEG2RAD,
    lonMax: (opts.lonMaxDeg ?? 180) * DEG2RAD,
    lonCount: Math.max(1, Math.floor(opts.lonCount ?? 18)),
  };
  try {
    const result = await sweepCoverageGrid(e.spice, {
      grid,
      assets,
      span,
      step: opts.stepSec ?? 300,
      minElevationRad: (opts.minElevationDeg ?? 5) * DEG2RAD,
    });
    if (isDisposed()) return;
    // Map every cell to the selected metric's [0, 1] colormap scalar (pure), so the contour
    // colors by the chosen metric and the legend (metric label + units) reads consistently.
    const scalars = metricScalars(result.cells, metric, k);
    const cells: CoverageOverlayCell[] = result.cells.map((c, i) => ({
      latRad: c.latRad,
      lonRad: c.lonRad,
      fom: scalars[i] ?? 0,
    }));
    const radii = await e.spice.bodvrd(body, 'RADII').catch(() => [6378.137]);
    if (isDisposed()) return;
    const bodyRadiusKm = radii[0] && Number.isFinite(radii[0]) ? radii[0] : 6378.137;
    const polarRadiusKm = radii[2] && Number.isFinite(radii[2]) ? radii[2] : bodyRadiusKm;
    // Fail loud rather than drape the grid at the scene origin: the overlay is anchored by body
    // name each frame, so an unresolved center body would silently sit at [0,0,0].
    if (!e.table.byBody.has(body)) {
      throw new CoverageOverlayError(
        `center body "${body}" is not in the ephemeris table, so the overlay cannot be anchored`,
      );
    }
    e.scene.setCoverageOverlay({
      anchorBody: body,
      bodyRadiusKm,
      polarRadiusKm,
      latCount: grid.latCount,
      lonCount: grid.lonCount,
      cells,
    });
    const summary = summarizeCoverage(result.cells, result.areaWeightedPercentCoverage, k);
    store.setState({
      coverageGrid: {
        cellCount: cells.length,
        areaWeightedPercentCoverage: result.areaWeightedPercentCoverage,
        label: `${assets.length} asset${assets.length === 1 ? '' : 's'} over ${body}`,
        assetCount: assets.length,
        metric: { id: metric.id, label: metric.label, unit: metric.unit, nFoldK: k },
        summary,
      },
    });
  } catch (err) {
    if (!isDisposed()) {
      e.scene.clearCoverageOverlay();
      store.setState({ coverageGrid: null });
    }
    console.error('coverage sweep failed', err);
    throw err;
  }
}

/** Clear the draped coverage overlay and its summary readout. */
export function clearCoverageGrid(e: EngineCore, store: AppStore): void {
  e.scene.clearCoverageOverlay();
  store.setState({ coverageGrid: null });
}

// The Lighting & Geometry domain ops live in ops-lighting.ts (so the heavier beta +
// intensity @bessel/events paths do not bloat this source file), but are re-exported
// here so the engine's lazy `import('./analysis-ops.ts')` seam pulls them into this same
// analysis chunk: that shares the @bessel/events + @bessel/timeline + @bessel/spice
// substrate with the eclipse/access ops instead of duplicating it in a second chunk.
export { computeBetaSeries, computeEclipsePhases, computeSolarIntensity } from './ops-lighting.ts';
