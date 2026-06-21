// The analysis-engine operations, split out of BesselEngine so they (and the heavy
// @bessel analysis packages they import) land in a lazy chunk instead of the first-paint
// bundle. engine.ts keeps thin async wrappers that dynamically import this module on first
// use; the dynamic import is the code-split boundary. Each function is standalone, taking
// the engine's core and store (plus a disposed guard and, for the propagator path, a small
// mutable TLE-state ref) as parameters, so nothing here depends on the BesselEngine class.

import { eclipseIntervals } from '@bessel/events';
import { computeAccess, computeElevationAccess, type Facility } from '@bessel/access';
import { figureOfMerit, walkerConstellation } from '@bessel/coverage';
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
} from '@bessel/propagator';
import { downloadBlob } from '@bessel/ui';
import { describeProvider, type ProviderKind, type ProviderSpec } from '@bessel/spice';
import { SAMPLE_TLE } from '../sample-tle.ts';
import type { AppStore } from '../store/index.ts';
import type { EngineCore } from './bootstrap.ts';
import { buildHpopForceModel, HPOP_FORCE_MODEL_LABELS, type HpopForceModel } from './hpop-model.ts';
import { runMcsDesign as runMcsDesignCore, type McsDesign } from './mcs.ts';
import { runOdDemo } from './od.ts';
import { centerMu } from './center-mu.ts';
import { positionAt } from '../sampler.ts';
import { fovHalfAngleRad, nadirOffAngleRad, intervalsFromFlags } from '../in-fov.ts';

// Earth gravity constants for the numerical (HPOP) propagation. Published WGS-84/EGM
// values, caller-injected because a PCK carries no GM or harmonics.
const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;
const EARTH_J2 = 1.08262668e-3;

/** Optional time-span override (seconds) for a span-based analysis tool. */
export interface AnalysisSpan {
  readonly spanSec?: number;
  readonly stepSec?: number;
}

/** A span override plus an optional target object (for range/access). */
export interface AnalysisTargetSpan extends AnalysisSpan {
  readonly target?: string;
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
 * Lighting analysis: compute the spacecraft's umbra (total-shadow) intervals over
 * one day from the current epoch, occulted by the mission center body, and store
 * them for the analysis panel. Requires a loaded spacecraft mission.
 */
export async function computeEclipse(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ eclipseUmbra: [], eclipseSpan: null });
    return;
  }
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
  try {
    const ecl = await eclipseIntervals(e.spice, {
      observer: sc,
      body,
      bodyFrame: `IAU_${body.toUpperCase()}`,
      span,
      step: opts.stepSec ?? 120,
    });
    if (!isDisposed()) store.setState({ eclipseUmbra: ecl.umbra, eclipseSpan: span });
  } catch (err) {
    if (!isDisposed()) store.setState({ eclipseUmbra: [], eclipseSpan: span });
    console.error('eclipse analysis failed', err);
    throw err;
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
  opts: AnalysisSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  if (!sc) {
    store.setState({ linkSeries: null });
    return;
  }
  const t0 = e.clock.state.et;
  const spanSec = opts.spanSec ?? 86400;
  const samples = 240;
  const et = new Float64Array(samples);
  for (let i = 0; i < samples; i++) et[i] = t0 + (i / (samples - 1)) * spanSec;
  try {
    // Earth relative to the spacecraft at each epoch, reduced to a downlink range.
    const xyz = await e.spice.spkposBatch('EARTH', et, 'J2000', 'NONE', sc);
    const ebN0 = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const distanceKm = Math.hypot(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!);
      // Representative Cassini X-band downlink to a DSN 34 m station.
      ebN0[i] = linkBudget({
        eirpDbW: 90,
        distanceKm,
        freqHz: 8.4e9,
        gOverTDbK: 53,
        dataRateBps: 14_000,
      }).ebN0Db;
    }
    if (!isDisposed()) {
      store.setState({ linkSeries: { et, value: ebN0, label: `${sc} to Earth Eb/N0 (dB)` } });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ linkSeries: null });
    console.error('link-budget analysis failed', err);
    throw err;
  }
}

/**
 * Access analysis: line-of-sight visibility windows from the spacecraft to the Sun
 * over one day, occulted by the mission center body (a true STK-style access run
 * through @bessel/access, the geometry-finder + window-algebra path). The result is
 * the sunlit window; its complement is the eclipse. Requires a spacecraft mission.
 */
export async function computeAccessTool(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisTargetSpan = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ accessResult: null });
    return;
  }
  const target = opts.target ?? 'SUN';
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
  try {
    const window = await computeAccess(e.spice, {
      observer: sc,
      target,
      span,
      step: opts.stepSec ?? 120,
      constraints: [{ kind: 'lineOfSight', body, bodyFrame: `IAU_${body.toUpperCase()}` }],
    });
    // Reduce the access window to a figure of merit (@bessel/coverage): the
    // fraction of the span with line of sight, the access count, and the worst gap.
    const fom = figureOfMerit(window, span);
    if (!isDisposed()) {
      store.setState({
        accessResult: {
          window,
          span,
          label: `${sc} to ${target}`,
          fom: {
            percentCoverage: fom.percentCoverage,
            accessCount: fom.accessCount,
            maxGapSec: fom.maxGapSec,
          },
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ accessResult: null });
    console.error('access analysis failed', err);
    throw err;
  }
}

/**
 * Instrument-target-visibility windows (B22): when a target body falls within the
 * active instrument's field of view, modeling the sensor as nadir-pointed (boresight
 * toward the center body). The FOV half-angle is read from the loaded sensor's
 * boundary rays; a target is in view when its off-boresight angle is within it. The
 * sweep uses the sampled ephemeris table (no extra worker round-trips), so it reuses
 * the same positions the frame loop already holds.
 */
export async function computeInstrumentFovWindows(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: AnalysisTargetSpan = {},
): Promise<void> {
  const inst = e.instrument;
  const sc = e.identity.spacecraftName;
  const center = e.identity.centerBody;
  const target = opts.target ?? 'Sun';
  if (
    !inst ||
    !sc ||
    !center ||
    !e.table.byBody.has(target) ||
    !e.table.byBody.has(sc) ||
    !e.table.byBody.has(center)
  ) {
    store.setState({ fovResult: null });
    return;
  }
  // Clamp the sweep to the sampled ephemeris window: positionAt clamps out-of-range
  // epochs to the table edge, so a span running past the data would freeze every body
  // and fabricate a static in/out result rather than reflecting real geometry.
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, Math.min(t0 + (opts.spanSec ?? 86400), e.table.et1)];
  const step = opts.stepSec ?? 120;
  try {
    const halfAngle = fovHalfAngleRad(inst.fov.boresight, inst.fov.bounds);
    const times: number[] = [];
    const flags: boolean[] = [];
    for (let t = span[0]; t <= span[1]; t += step) {
      const off = nadirOffAngleRad(
        positionAt(e.table, sc, t),
        positionAt(e.table, center, t),
        positionAt(e.table, target, t),
      );
      times.push(t);
      flags.push(off <= halfAngle);
    }
    const window = intervalsFromFlags(times, flags);
    const fom = figureOfMerit(window, span);
    if (!isDisposed()) {
      store.setState({
        fovResult: {
          window,
          span,
          label: `${inst.descriptor.name} sees ${target}`,
          fom: {
            percentCoverage: fom.percentCoverage,
            accessCount: fom.accessCount,
            maxGapSec: fom.maxGapSec,
          },
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ fovResult: null });
    console.error('instrument FOV analysis failed', err);
    throw err;
  }
}

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
  opts: { secondary?: string } = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ conjunction: null });
    return;
  }
  const secondary = opts.secondary ?? body;
  const et = e.clock.state.et;
  try {
    const rel = await e.spice.spkezr(secondary, et, 'J2000', 'NONE', sc);
    const ca = closestApproachLinear(rel.position, rel.velocity);
    // An illustrative encounter: 1 km position sigma per axis, a 100 m combined
    // hard-body radius, the miss projected onto two encounter-plane axes.
    const pc = collisionProbability2D({
      radiusKm: 0.1,
      sigmaXKm: 1,
      sigmaYKm: 1,
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
 * Constellation design: generate a Walker Delta 24/3/1 LEO pattern (@bessel/
 * coverage) and report its structure. Pure (element-set generation); independent of
 * the loaded mission, surfacing the constellation designer.
 */
export function computeConstellation(store: AppStore): void {
  const totalSats = 24;
  const planes = 3;
  const phasing = 1;
  const inclinationDeg = 53;
  const altitudeKm = 700;
  const a = 6378.137 + altitudeKm;
  const sats = walkerConstellation({
    a,
    e: 0,
    i: (inclinationDeg * Math.PI) / 180,
    argp: 0,
    totalSats,
    planes,
    phasing,
    pattern: 'delta',
  });
  store.setState({
    constellation: {
      totalSats: sats.length,
      planes,
      perPlane: sats.length / planes,
      pattern: 'delta',
      inclinationDeg,
      altitudeKm,
    },
  });
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
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ slewSeries: null });
    return;
  }
  const et = e.clock.state.et;
  try {
    const [nadirM, sunM] = await Promise.all([
      nadirAttitude(e.spice, sc, body, et),
      sunPointingAttitude(e.spice, sc, body, et),
    ]);
    const a0 = await e.spice.m2q(nadirM);
    const a1 = await e.spice.m2q(sunM);
    const q0: Quaternion = [a0[0]!, a0[1]!, a0[2]!, a0[3]!];
    const q1: Quaternion = [a1[0]!, a1[1]!, a1[2]!, a1[3]!];
    // 2 deg/s max rate, 0.5 deg/s^2 max acceleration.
    const slew = eigenAxisSlew(q0, q1, (2 * Math.PI) / 180, (0.5 * Math.PI) / 180);
    const samples = 120;
    const t = new Float64Array(samples);
    const angleDeg = new Float64Array(samples);
    const rad2deg = 180 / Math.PI;
    for (let i = 0; i < samples; i++) {
      const ti = (i / (samples - 1)) * slew.duration;
      const q = slew.at(ti);
      const dotAbs = Math.abs(q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]);
      t[i] = ti;
      angleDeg[i] = 2 * Math.acos(Math.min(1, dotAbs)) * rad2deg;
    }
    if (!isDisposed()) {
      store.setState({
        slewSeries: { et: t, value: angleDeg, label: `${sc} nadir->Sun slew (deg)` },
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
        groundTrack: { lon: series.columns[0]!, lat: series.columns[1]!, label: `${sc} ground track` },
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
          track: { lon: series.columns[1]!, lat: series.columns[2]!, label: `${SAMPLE_TLE.name} ground track` },
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
  const deg = Math.PI / 180;
  const facility: Facility = {
    body: 'EARTH',
    bodyFrame: 'IAU_EARTH',
    lonRad: -116.89 * deg,
    latRad: 35.426 * deg,
    altKm: 1.0,
  };
  // A 12 hour span at a 2 minute step keeps the per-epoch elevation sweep responsive
  // (passes are far longer than the step); the range gate uses the same cadence.
  const span: [number, number] = [last.epoch, last.epoch + 43200];
  const maxRangeKm = 9000;
  try {
    // Elevation-mask access intersected with a geocentric range gate: two composed
    // constraints (the elevation finder and the gfdist distance finder).
    const elevation = await computeElevationAccess(e.spice, facility, target, span, 120, 10 * deg);
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
