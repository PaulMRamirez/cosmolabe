// Per-domain analysis ops for the Access & Comms tab (analysis-UX Phase 1): the composable
// access constraint stack and the selectable-pointing in-FOV sweep. Split out of analysis-ops.ts
// so the Access-specific surface (and the @bessel/access + in-fov geometry it pulls) lands in
// the lazy analysis chunk on first use, behind the engine's dynamic-import boundary. Each op is
// standalone, taking the engine core + store + a disposed guard, mirroring analysis-ops.ts.
// Fails loud: a malformed constraint or an unresolved body raises a typed, located error.

import {
  computeAccess,
  computeAzElMaskWindow,
  bodyRadiiKm,
  facilityTopoFrame,
  topocentricElAz,
  type AccessConstraint,
  type Facility,
  type AzElMaskConstraint,
} from '@bessel/access';
import { SAMPLE_RIDGE_DEM, type Dem } from '@bessel/terrain';
import { figureOfMerit } from '@bessel/coverage';
import { nadirAttitude, type Quaternion } from '@bessel/attitude';
import { windowIntersect, type Window } from '@bessel/timeline';
import { DEG2RAD, RAD2DEG } from '../angles.ts';
import { positionAt } from '../sampler.ts';
import {
  fovHalfAngleRad,
  pointingOffAngleRad,
  intervalsFromFlags,
  type FovPointing,
} from '../in-fov.ts';
import {
  DEFAULT_ACCESS_CONSTRAINTS,
  DEFAULT_LINK_WORKSHEET,
  DEFAULT_SLEW_FEASIBILITY,
  DEFAULT_OBSERVATION_SCHEDULE,
  type AccessConstraintSpec,
  type LinkWorksheetSpec,
  type SlewFeasibilitySpec,
  type ObservationScheduleSpec,
  type TerrainSource,
} from './analysis-defaults.ts';
import { MODCOD_TABLE } from '@bessel/rf';
import { assembleLinkWorksheet, type LinkWorksheetConfig, type PassGeometry } from '../panels/link-worksheet.ts';
import { decideSlewFeasibility } from '../panels/slew-feasibility.ts';
import {
  buildObservationSchedule,
  type ScheduleTarget,
} from '../panels/observation-schedule.ts';
import type {
  AppStore,
  AccessFom,
  GroundStation,
  ScenarioState,
  StationPass,
  LinkWorksheetCase,
  ObservationScheduleResult,
} from '../store/index.ts';
import type { EngineCore } from './bootstrap.ts';

/** [ux-p3-access] Resolve a terrain DEM from the selected terrain source: the built-in deterministic
 *  SAMPLE ridge for 'sample-ridge', else null ('none', the toggle stays inert). A real arbitrary-DEM
 *  source would extend the TerrainSource union and return its loaded DEM here. */
export function resolveTerrainDem(source: TerrainSource): Dem | null {
  return source === 'sample-ridge' ? SAMPLE_RIDGE_DEM : null;
}

/** The active registered ground station from the scenario slice, or null when none is selected.
 *  Inlined here (rather than imported from station-registry, which the eager engine shell already
 *  owns) so this lazy chunk does not also pull the registry module. */
function activeStation(scenario: ScenarioState): GroundStation | null {
  const id = scenario.activeStationId;
  return id === null ? null : scenario.stations.find((s) => s.id === id) ?? null;
}

/** A typed, located error for an Access-tab op the engine cannot satisfy (fail loudly). */
export class OpsAccessError extends Error {
  override readonly name = 'OpsAccessError';
  constructor(message: string) {
    super(`ops-access: ${message}`);
  }
}

/** One labelled member of the assembled access stack: the constraint to run plus the chip
 *  text the panel shows for it. Kept alongside the constraint so the per-constraint breakdown
 *  (each constraint run alone) can name how each narrowed the window. */
export interface LabelledConstraint {
  readonly label: string;
  readonly constraint: AccessConstraint;
}

/** Assemble the enabled members of a constraint spec into labelled access constraints, in a
 *  stable order. Pure (no SPICE), so the assembly is unit-tested directly. The line-of-sight
 *  occulting body is the mission center body; range/range-rate/sun-keepout read their bands
 *  from the spec; the az/el mask (UNGATED in Phase 2) reads the ACTIVE ground station passed in,
 *  failing loud when the toggle is on but no station is active; the terrain LOS (UNGATED in Phase 3)
 *  reads a DEM from the chosen terrain source (the built-in sample ridge), failing loud when enabled
 *  with no source selected. A spec with nothing enabled yields an empty stack (computeAccess then
 *  returns the whole span). Fails loud on an inverted band. */
export function assembleConstraints(
  spec: AccessConstraintSpec,
  centerBody: string,
  station?: GroundStation | null,
): readonly LabelledConstraint[] {
  const out: LabelledConstraint[] = [];
  if (spec.losEnabled) {
    out.push({
      label: `Line of sight (not occulted by ${centerBody})`,
      constraint: { kind: 'lineOfSight', body: centerBody, bodyFrame: `IAU_${centerBody.toUpperCase()}` },
    });
  }
  if (spec.rangeEnabled) {
    if (spec.rangeMaxKm < spec.rangeMinKm) {
      throw new OpsAccessError(
        `range band is empty: maxKm (${spec.rangeMaxKm}) is below minKm (${spec.rangeMinKm})`,
      );
    }
    out.push({
      label: `Range ${spec.rangeMinKm} to ${spec.rangeMaxKm} km`,
      constraint: { kind: 'range', minKm: spec.rangeMinKm, maxKm: spec.rangeMaxKm },
    });
  }
  if (spec.rangeRateEnabled) {
    if (spec.rangeRateMaxKmS < spec.rangeRateMinKmS) {
      throw new OpsAccessError(
        `range-rate band is empty: maxKmS (${spec.rangeRateMaxKmS}) is below minKmS (${spec.rangeRateMinKmS})`,
      );
    }
    out.push({
      label: `Range rate ${spec.rangeRateMinKmS} to ${spec.rangeRateMaxKmS} km/s`,
      constraint: { kind: 'rangeRate', minKmS: spec.rangeRateMinKmS, maxKmS: spec.rangeRateMaxKmS },
    });
  }
  if (spec.sunKeepoutEnabled) {
    if (!(spec.sunKeepoutDeg > 0)) {
      throw new OpsAccessError(`sun keep-out must be > 0 deg, got ${spec.sunKeepoutDeg}`);
    }
    out.push({
      label: `Sun keep-out >= ${spec.sunKeepoutDeg} deg`,
      constraint: { kind: 'sunExclusion', keepoutRad: spec.sunKeepoutDeg * DEG2RAD },
    });
  }
  if (spec.azElMaskEnabled) {
    // UNGATED in Phase 2: the az/el horizon mask reads the active registered ground station; fail
    // loud (rather than fabricate a facility) when the toggle is on but no station is selected.
    if (!station) {
      throw new OpsAccessError('az/el mask is enabled but no ground station is active: select one in the context bar');
    }
    const { facility, constraint } = stationConstraint(station);
    out.push({
      label: `Az/el mask at ${station.name} (>= ${((station.minElevationRad ?? 5 * DEG2RAD) * RAD2DEG).toFixed(1)} deg)`,
      constraint: { ...constraint, facility },
    });
  }
  if (spec.terrainLosEnabled) {
    // UNGATED in Phase 3: the terrain LOS reads a DEM from the chosen terrain source. Fail loud
    // (rather than fabricate a flat DEM) when the toggle is on but no source is selected.
    const dem = resolveTerrainDem(spec.terrainSource);
    if (!dem) {
      throw new OpsAccessError(
        'terrain LOS is enabled but no terrain source is selected: choose a terrain source (e.g. the sample ridge)',
      );
    }
    out.push({
      label: `Terrain LOS over ${centerBody} (${spec.terrainSource} DEM)`,
      constraint: {
        kind: 'terrainLos',
        body: centerBody,
        bodyFrame: `IAU_${centerBody.toUpperCase()}`,
        dem,
      },
    });
  }
  return out;
}

const fomOf = (window: Window, span: readonly [number, number]): AccessFom => {
  const f = figureOfMerit(window, span);
  return { percentCoverage: f.percentCoverage, accessCount: f.accessCount, maxGapSec: f.maxGapSec };
};

/**
 * Composable access stack: run computeAccess over the assembled constraint array (the
 * surviving window is the intersection of the enabled constraints), reduce it to a figure
 * of merit, and build a per-constraint breakdown by running EACH enabled constraint alone so
 * the panel can show how much each one narrowed the span. Requires a spacecraft mission; a
 * no-op (clears the result) otherwise. (analysis-UX section 4, observation planner.)
 */
export async function computeAccessStack(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  spec: AccessConstraintSpec = DEFAULT_ACCESS_CONSTRAINTS,
  target?: string,
  opts: { spanSec?: number; stepSec?: number } = {},
): Promise<void> {
  const sc = e.identity.spacecraftName;
  const body = e.identity.centerBody;
  if (!sc || !body) {
    store.setState({ accessResult: null, accessBreakdown: null });
    return;
  }
  const obsTarget = target ?? 'SUN';
  const t0 = e.clock.state.et;
  const step = opts.stepSec ?? 120;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
  const labelled = assembleConstraints(spec, body, activeStation(store.getState().scenario));
  try {
    const window = await computeAccess(e.spice, {
      observer: sc,
      target: obsTarget,
      span,
      step,
      constraints: labelled.map((l) => l.constraint),
    });
    // Per-constraint breakdown: each enabled constraint run on its own over the span, so the
    // note reports the coverage each one admits in isolation (how much it narrows the span).
    const breakdown = await Promise.all(
      labelled.map(async (l) => {
        const lone = await computeAccess(e.spice, {
          observer: sc,
          target: obsTarget,
          span,
          step,
          constraints: [l.constraint],
        });
        return { label: l.label, fom: fomOf(lone, span) };
      }),
    );
    if (!isDisposed()) {
      store.setState({
        accessResult: { window, span, label: `${sc} to ${obsTarget}`, fom: fomOf(window, span) },
        accessBreakdown: breakdown,
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ accessResult: null, accessBreakdown: null });
    console.error('access-stack analysis failed', err);
    throw err;
  }
}

/** Sample the FOV-only in-view flags of one target over the span: the off-boresight angle under the
 *  chosen pointing mode is within the FOV half-angle. Pure over the sampled ephemeris table; shared
 *  by the single-target in-FOV sweep and the multi-target schedule so both read identical geometry. */
function sweepFovFlags(
  e: EngineCore,
  pointing: FovPointing,
  halfAngle: number,
  obsTarget: string,
  sc: string,
  center: string,
  span: readonly [number, number],
  step: number,
): { times: number[]; flags: boolean[] } {
  const needsSun = pointing === 'sun';
  const ZERO: readonly [number, number, number] = [0, 0, 0];
  const times: number[] = [];
  const flags: boolean[] = [];
  for (let t = span[0]; t <= span[1]; t += step) {
    const off = pointingOffAngleRad(
      pointing,
      positionAt(e.table, sc, t),
      positionAt(e.table, center, t),
      needsSun ? positionAt(e.table, 'Sun', t) : ZERO,
      positionAt(e.table, obsTarget, t),
    );
    times.push(t);
    flags.push(off <= halfAngle);
  }
  return { times, flags };
}

/**
 * Selectable-pointing in-FOV sweep: model the sensor boresight along the chosen mode (nadir
 * toward the center body, or sun toward the Sun) and find when the observation target falls
 * within the FOV half-angle. Reports BOTH the FOV-only window and the post-constraint surviving
 * window (FOV intersected with the assembled access stack), so the planner reads how the
 * constraints narrow the raw geometric visibility. Reuses the sampled ephemeris table (no extra
 * worker round-trips). Requires a sensor + spacecraft; a no-op (clears) otherwise.
 */
export async function computeFovWindows(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  pointing: FovPointing = 'nadir',
  spec: AccessConstraintSpec = DEFAULT_ACCESS_CONSTRAINTS,
  target?: string,
  opts: { spanSec?: number; stepSec?: number } = {},
): Promise<void> {
  const inst = e.instrument;
  const sc = e.identity.spacecraftName;
  const center = e.identity.centerBody;
  const obsTarget = target ?? 'Sun';
  // Sun pointing also needs the Sun sampled; nadir pointing does not.
  const needsSun = pointing === 'sun';
  if (
    !inst ||
    !sc ||
    !center ||
    !e.table.byBody.has(obsTarget) ||
    !e.table.byBody.has(sc) ||
    !e.table.byBody.has(center) ||
    (needsSun && !e.table.byBody.has('Sun'))
  ) {
    store.setState({ fovResult: null, fovSurviving: null });
    return;
  }
  const t0 = e.clock.state.et;
  // Clamp the sweep to the sampled ephemeris window (positionAt clamps out-of-range epochs to
  // the table edge, which would fabricate a frozen in/out result past the data).
  const span: [number, number] = [t0, Math.min(t0 + (opts.spanSec ?? 86400), e.table.et1)];
  const step = opts.stepSec ?? 120;
  try {
    const halfAngle = fovHalfAngleRad(inst.fov.boresight, inst.fov.bounds);
    // nadir mode never reads the Sun position; the shared sweep samples it only when sun-pointing.
    const { times, flags } = sweepFovFlags(e, pointing, halfAngle, obsTarget, sc, center, span, step);
    const fovOnly = intervalsFromFlags(times, flags);
    const pointingLabel = pointing === 'sun' ? 'Sun-pointed' : 'nadir-pointed';
    // Surviving window: the FOV-only window intersected with the assembled access stack, run
    // over the same span/step so the two read against the same geometry.
    const labelled = assembleConstraints(spec, center, activeStation(store.getState().scenario));
    const accessWindow = await computeAccess(e.spice, {
      observer: sc,
      target: obsTarget,
      span,
      step,
      constraints: labelled.map((l) => l.constraint),
    });
    const surviving = windowIntersect(fovOnly, accessWindow);
    if (!isDisposed()) {
      store.setState({
        fovResult: {
          window: fovOnly,
          span,
          label: `${inst.descriptor.name} sees ${obsTarget} (${pointingLabel})`,
          fom: fomOf(fovOnly, span),
        },
        fovSurviving: {
          window: surviving,
          span,
          label: `${inst.descriptor.name} sees ${obsTarget}, post-constraint`,
          fom: fomOf(surviving, span),
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ fovResult: null, fovSurviving: null });
    console.error('in-FOV pointing analysis failed', err);
    throw err;
  }
}

// -- [ux-p2-access] Ground-station passes, link worksheet, and slew feasibility ----------------
// The three Phase-2 access/comms surfaces. computeStationPasses UNGATES the az/el-mask access
// constraint against the ACTIVE registered ground station: it runs computeAzElMaskWindow over the
// station (the constant min-elevation floor or, when the station carries one, an az-indexed mask),
// then samples each rise/set interval for its max-elevation epoch + the slant ranges the link
// worksheet binds to. computeLinkWorksheet binds to the SELECTED pass (or a representative geometry)
// and assembles the itemized budget at the worst-case and nominal elevation plus a margin-vs-time
// series. computeSlewFeasibility binds to the SELECTED consecutive pass pair and decides whether the
// eigen-axis slew between the two pointings fits in the inter-pass gap. All fail loud.

/** Resolve the spacecraft the station passes track: the scenario primary, else the mission
 *  spacecraft. Fails loud when neither is set (the passes need a target to track). */
function requireSpacecraft(e: EngineCore, store: AppStore): string {
  const primary = store.getState().scenario.primarySpacecraft;
  const sc = primary ?? e.identity.spacecraftName;
  if (!sc) {
    throw new OpsAccessError('no spacecraft to track: set a primary spacecraft or load a mission');
  }
  return sc;
}

/** Resolve the active registered ground station, failing loud when none is selected. */
function requireActiveStation(store: AppStore): GroundStation {
  const station = activeStation(store.getState().scenario);
  if (!station) {
    throw new OpsAccessError('no active ground station: add and select one in the context bar');
  }
  return station;
}

/** Build a Facility + az/el-mask constraint for a station over an Earth-class body. A station with
 *  no mask uses its constant min-elevation floor (default 5 deg); the body is EARTH for a registered
 *  ground site (the registry is geodetic Earth sites in this phase). */
function stationConstraint(station: GroundStation): { facility: Facility; constraint: AzElMaskConstraint } {
  const facility: Facility = {
    body: 'EARTH',
    bodyFrame: 'IAU_EARTH',
    lonRad: station.lonRad,
    latRad: station.latRad,
    altKm: station.altKm,
  };
  const minElevationRad = station.minElevationRad ?? 5 * DEG2RAD;
  const constraint: AzElMaskConstraint = { kind: 'azElMask', facility, minElevationRad };
  return { facility, constraint };
}

/** Sample one rise/set interval to find its max-elevation epoch and the slant ranges + elevations at
 *  the max-elevation and worst-case (lowest at the pass edges) geometry. Reuses the facility topo
 *  frame; range is |target - site| in the body-fixed frame. */
async function samplePass(
  e: EngineCore,
  facility: Facility,
  spacecraft: string,
  rise: number,
  set: number,
  id: string,
): Promise<StationPass> {
  const { equatorialKm: re, polarKm: rp } = await bodyRadiiKm(e.spice, facility.body);
  const frame = facilityTopoFrame(facility, re, rp);
  const samples = 30;
  let maxEl = -Infinity;
  let maxEpoch = rise;
  let maxRange = 0;
  let worstEl = Infinity;
  let worstRange = 0;
  for (let i = 0; i <= samples; i++) {
    const et = rise + (i / samples) * (set - rise);
    const { position } = await e.spice.spkpos(spacecraft, et, facility.bodyFrame, 'NONE', facility.body);
    const { elevationRad } = topocentricElAz(frame, position);
    const rangeKm = Math.hypot(position.x - frame.pos.x, position.y - frame.pos.y, position.z - frame.pos.z);
    if (elevationRad > maxEl) {
      maxEl = elevationRad;
      maxEpoch = et;
      maxRange = rangeKm;
    }
    if (elevationRad < worstEl) {
      worstEl = elevationRad;
      worstRange = rangeKm;
    }
  }
  return {
    id,
    rise,
    set,
    maxElevationEpoch: maxEpoch,
    maxElevationRad: maxEl,
    maxElevationRangeKm: maxRange,
    worstElevationRad: Number.isFinite(worstEl) ? worstEl : maxEl,
    worstElevationRangeKm: worstRange || maxRange,
  };
}

/**
 * Az/el-masked station passes: rise/set windows of the tracked spacecraft over the ACTIVE registered
 * ground station, each reduced to its max-elevation epoch + the slant ranges/elevations the link
 * worksheet binds to. Runs computeAzElMaskWindow (the Phase-1 constraint, now UNGATED against a real
 * station) over the span, then samples each interval. Requires an active station + a spacecraft;
 * fails loud otherwise. Clears the selection so a stale selectedPassId never points past the run.
 */
export async function computeStationPasses(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  opts: { spanSec?: number; stepSec?: number } = {},
): Promise<void> {
  const station = requireActiveStation(store);
  const spacecraft = requireSpacecraft(e, store);
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
  const step = opts.stepSec ?? 60;
  const { facility, constraint } = stationConstraint(station);
  try {
    const window = await computeAzElMaskWindow(e.spice, spacecraft, span, step, 'NONE', constraint);
    const passes: StationPass[] = [];
    for (let i = 0; i < window.length; i++) {
      if (isDisposed()) return;
      const [rise, set] = window[i]!;
      passes.push(await samplePass(e, facility, spacecraft, rise, set, `pass-${i}`));
    }
    if (!isDisposed()) {
      store.setState({
        stationPasses: {
          stationName: station.name,
          spacecraft,
          span,
          passes,
          fom: fomOf(window, span),
          label: `${spacecraft} over ${station.name}`,
        },
        // A fresh passes run supersedes any prior pass selection / pair / worksheet / slew result.
        selectedPassId: null,
        selectedWindowPair: null,
        linkWorksheet: null,
        slewFeasibility: null,
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ stationPasses: null });
    console.error('station passes analysis failed', err);
    throw err;
  }
}

/** Resolve a MODCOD by name from the @bessel/rf table, failing loud on an unknown name. */
function resolveModcod(name: string): { name: string; requiredEbN0Db: number } {
  const modcod = MODCOD_TABLE.find((m) => m.name === name);
  if (!modcod) {
    throw new OpsAccessError(`unknown MODCOD "${name}" (not in MODCOD_TABLE)`);
  }
  return { name: modcod.name, requiredEbN0Db: modcod.requiredEbN0Db };
}

/** Translate the panel link spec + a resolved required Eb/N0 into the pure worksheet config. */
function worksheetConfig(spec: LinkWorksheetSpec, requiredEbN0Db: number): LinkWorksheetConfig {
  return {
    eirpDbW: spec.eirpDbW,
    freqHz: spec.freqGHz * 1e9,
    gOverTDbK: spec.gOverTDbK,
    dataRateBps: spec.dataRateBps,
    antennaPattern: spec.antennaPattern,
    hpbwDeg: spec.hpbwDeg,
    pointingErrorDeg: spec.pointingErrorDeg,
    txPolarization: spec.txPolarization,
    rxPolarization: spec.rxPolarization,
    polMisalignDeg: spec.polMisalignDeg,
    rainRateMmHr: spec.rainRateMmHr,
    rainCoeffsKey: spec.rainCoeffsKey,
    gaseousZenithDb: spec.gaseousZenithDb,
    requiredEbN0Db,
  };
}

/** Assemble one labelled worksheet case (worst-case / nominal) from a geometry point. */
function worksheetCase(
  caseLabel: string,
  config: LinkWorksheetConfig,
  geometry: PassGeometry,
): LinkWorksheetCase {
  const sheet = assembleLinkWorksheet(config, geometry);
  return {
    caseLabel,
    elevationDeg: geometry.elevationRad * RAD2DEG,
    rangeKm: geometry.rangeKm,
    lines: sheet.lines.map((l) => ({ id: l.id, label: l.label, value: l.value, unit: l.unit })),
    ebN0Db: sheet.ebN0Db,
    requiredEbN0Db: sheet.requiredEbN0Db,
    marginDb: sheet.marginDb,
  };
}

/**
 * The itemized link-budget WORKSHEET bound to the SELECTED station pass (active-selection). At the
 * worst-case (lowest-elevation pass edge) AND nominal (max-elevation) geometry it rolls up the line-
 * by-line budget through the pure assembleLinkWorksheet (the @bessel/rf builders), and samples a
 * margin-vs-time series across the pass for the chart (the required-Eb/N0 threshold is drawn from the
 * MODCOD). With no pass selected it falls back to a representative geometry (a 700 km LEO downlink at
 * 30 deg) with a clear note. Fails loud on an unknown MODCOD or a missing passes run.
 */
export async function computeLinkWorksheet(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  spec: LinkWorksheetSpec = DEFAULT_LINK_WORKSHEET,
): Promise<void> {
  const modcod = resolveModcod(spec.modcodName);
  const config = worksheetConfig(spec, modcod.requiredEbN0Db);
  const state = store.getState();
  const result = state.stationPasses;
  const selectedId = state.selectedPassId;
  const selectedPass = result && selectedId ? result.passes.find((p) => p.id === selectedId) ?? null : null;
  try {
    // The geometry the worksheet is computed at: the selected pass edges, or a representative point.
    const worstGeom: PassGeometry = selectedPass
      ? { rangeKm: selectedPass.worstElevationRangeKm, elevationRad: selectedPass.worstElevationRad }
      : { rangeKm: 2400, elevationRad: 10 * DEG2RAD };
    const nominalGeom: PassGeometry = selectedPass
      ? { rangeKm: selectedPass.maxElevationRangeKm, elevationRad: selectedPass.maxElevationRad }
      : { rangeKm: 800, elevationRad: 60 * DEG2RAD };
    const worstCase = worksheetCase('Worst-case elevation', config, worstGeom);
    const nominal = worksheetCase('Nominal (max) elevation', config, nominalGeom);

    // Margin-vs-time over the pass: sample the topocentric range + elevation across the rise/set
    // window and roll up the margin at each, so the chart can draw the required-Eb/N0 threshold.
    const marginSeries = await buildMarginSeries(e, store, config, selectedPass);

    if (!isDisposed()) {
      store.setState({
        linkWorksheet: {
          passId: selectedPass?.id ?? null,
          modcodName: modcod.name,
          requiredEbN0Db: modcod.requiredEbN0Db,
          worstCase,
          nominal,
          marginSeries,
          note: selectedPass
            ? ''
            : 'representative geometry: no pass selected (select a pass row to bind to real geometry)',
          label: selectedPass
            ? `Link worksheet over ${result?.stationName ?? 'station'} pass`
            : 'Link worksheet (representative geometry)',
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ linkWorksheet: null });
    console.error('link worksheet failed', err);
    throw err;
  }
}

/** Build the margin-vs-time series over the selected pass (or a short synthetic ramp when no pass is
 *  selected), rolling up the worksheet margin at each sampled topocentric geometry. */
async function buildMarginSeries(
  e: EngineCore,
  store: AppStore,
  config: LinkWorksheetConfig,
  selectedPass: StationPass | null,
): Promise<{ et: Float64Array; value: Float64Array; label: string }> {
  if (!selectedPass) {
    // No pass: a representative elevation ramp from 10 to 60 deg at a fixed mid-pass range, so the
    // chart still shows the margin trend vs the threshold (the note marks it representative).
    const n = 24;
    const et = new Float64Array(n);
    const value = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const frac = i / (n - 1);
      const elevationRad = (10 + frac * 50) * DEG2RAD;
      et[i] = i;
      value[i] = assembleLinkWorksheet(config, { rangeKm: 1200, elevationRad }).marginDb;
    }
    return { et, value, label: 'Margin over representative pass (dB)' };
  }
  const station = requireActiveStation(store);
  const spacecraft = requireSpacecraft(e, store);
  const { facility } = stationConstraint(station);
  const { equatorialKm: re, polarKm: rp } = await bodyRadiiKm(e.spice, facility.body);
  const frame = facilityTopoFrame(facility, re, rp);
  const n = 30;
  const et = new Float64Array(n);
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = selectedPass.rise + (i / (n - 1)) * (selectedPass.set - selectedPass.rise);
    const { position } = await e.spice.spkpos(spacecraft, t, facility.bodyFrame, 'NONE', facility.body);
    const { elevationRad } = topocentricElAz(frame, position);
    const rangeKm = Math.hypot(position.x - frame.pos.x, position.y - frame.pos.y, position.z - frame.pos.z);
    et[i] = t;
    value[i] = assembleLinkWorksheet(config, { rangeKm, elevationRad: Math.max(elevationRad, 1e-3) }).marginDb;
  }
  return { et, value, label: `Margin over ${station.name} pass (dB)` };
}

/** Resolve the attitude the sensor holds during a pass under the slew mode: target-track points at
 *  the body center (nadir) at the pass's max-elevation epoch; inertial holds the J2000 identity. */
async function passAttitude(
  e: EngineCore,
  spacecraft: string,
  pass: StationPass,
  mode: SlewFeasibilitySpec['mode'],
): Promise<Quaternion> {
  if (mode === 'inertial') return [1, 0, 0, 0];
  const matrix = await nadirAttitude(e.spice, spacecraft, 'EARTH', pass.maxElevationEpoch);
  const q = await e.spice.m2q(matrix);
  return [q[0]!, q[1]!, q[2]!, q[3]!];
}

/**
 * Slew feasibility between the two SELECTED consecutive passes (active-selection: selectedWindowPair).
 * Resolves each pass's pointing under the chosen mode (target-track = nadir at the pass apex, or a
 * fixed inertial attitude), then runs the pure decideSlewFeasibility: does the eigen-axis slew fit in
 * the gap between the first pass's set and the second pass's rise? Fails loud when no pair is selected
 * or the pair ids are not in the current passes run.
 */
export async function computeSlewFeasibility(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  spec: SlewFeasibilitySpec = DEFAULT_SLEW_FEASIBILITY,
): Promise<void> {
  const state = store.getState();
  const pair = state.selectedWindowPair;
  const result = state.stationPasses;
  if (!pair || !result) {
    throw new OpsAccessError('select two consecutive passes before checking slew feasibility');
  }
  const first = result.passes.find((p) => p.id === pair[0]);
  const second = result.passes.find((p) => p.id === pair[1]);
  if (!first || !second) {
    throw new OpsAccessError('the selected pass pair is not in the current passes run; re-run passes');
  }
  const spacecraft = requireSpacecraft(e, store);
  try {
    const [fromQuat, toQuat] = await Promise.all([
      passAttitude(e, spacecraft, first, spec.mode),
      passAttitude(e, spacecraft, second, spec.mode),
    ]);
    const verdict = decideSlewFeasibility(
      { firstWindow: [first.rise, first.set], secondWindow: [second.rise, second.set], fromQuat, toQuat },
      { maxRateDegPerSec: spec.maxRateDegPerSec, maxAccelDegPerSec2: spec.maxAccelDegPerSec2 },
    );
    if (!isDisposed()) {
      store.setState({
        slewFeasibility: {
          fromPassId: first.id,
          toPassId: second.id,
          mode: spec.mode,
          slewAngleDeg: verdict.slewAngleDeg,
          slewDurationSec: verdict.slewDurationSec,
          gapSec: verdict.gapSec,
          slackSec: verdict.slackSec,
          fits: verdict.fits,
          label: `${spacecraft} slew between ${result.stationName} passes`,
        },
      });
    }
  } catch (err) {
    if (!isDisposed()) store.setState({ slewFeasibility: null });
    console.error('slew feasibility failed', err);
    throw err;
  }
}

// -- [ux-p3-access] Multi-target observation schedule -------------------------------------------
// computeObservationSchedule takes a LIST of observation targets, the active instrument/FOV + the
// in-FOV pointing mode, and the access/keepout constraint stack; computes each target's in-FOV +
// post-constraint surviving windows (the same geometry the single-target in-FOV card shows); models
// the attitude the sensor holds while observing each target (the boresight aligned to the line of
// sight at the observation start); then builds a CONFLICT-FREE SCHEDULE through the pure greedy
// buildObservationSchedule, where the eigen-axis slew between consecutive scheduled targets must fit
// the gap (reusing the Phase-2 slew model). The result is the ordered timeline + any unscheduled
// (conflicted) targets. Requires a sensor + spacecraft; clears the result otherwise. Fails loud.

/** A unit body-fixed line-of-sight direction from the spacecraft to a target at an epoch, sampled
 *  from the ephemeris table. The schedule uses this to give each target a distinct pointing. */
function losUnit(e: EngineCore, sc: string, target: string, t: number): [number, number, number] {
  const s = positionAt(e.table, sc, t);
  const g = positionAt(e.table, target, t);
  const d: [number, number, number] = [g[0] - s[0], g[1] - s[1], g[2] - s[2]];
  const m = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / m, d[1] / m, d[2] / m];
}

/** Build the minimal-rotation quaternion ([w,x,y,z]) that aligns the sensor boresight (+Z) to a
 *  unit line-of-sight direction. Pure and deterministic: the slew model only needs the relative
 *  attitude between two targets, and this gives each target a pointing fixed by its geometry. The
 *  near-antiparallel case (los ~ -Z) falls back to a 180 deg rotation about +X. */
function boresightToLosQuat(los: readonly [number, number, number]): Quaternion {
  const z: [number, number, number] = [0, 0, 1];
  const dot = z[0] * los[0] + z[1] * los[1] + z[2] * los[2];
  if (dot > 1 - 1e-9) return [1, 0, 0, 0]; // already aligned
  if (dot < -1 + 1e-9) return [0, 1, 0, 0]; // antiparallel: 180 deg about +X
  // axis = z x los, angle = acos(dot); quaternion [cos(a/2), sin(a/2) * axis_hat].
  const ax: [number, number, number] = [
    z[1] * los[2] - z[2] * los[1],
    z[2] * los[0] - z[0] * los[2],
    z[0] * los[1] - z[1] * los[0],
  ];
  const axMag = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), (ax[0] / axMag) * s, (ax[1] / axMag) * s, (ax[2] / axMag) * s];
}

/** Parse a target list string (comma / whitespace separated) into de-duplicated trimmed names. */
export function parseTargetList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[,\s]+/)) {
    const name = tok.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Multi-target observation schedule (analysis-UX Phase 3, observation planner). For each target in
 * the list, sweep the in-FOV window under the pointing mode and intersect it with the assembled
 * access/keepout constraint stack (the surviving windows), and resolve the attitude the sensor holds
 * while observing it (boresight aligned to the line of sight at the first window start). Feed those
 * into the pure greedy buildObservationSchedule to produce a conflict-free ordered timeline where the
 * eigen-axis slew between consecutive targets fits the gap, plus the unscheduled (conflicted) targets.
 * A target not in the sampled ephemeris table is reported unscheduled (no window) rather than failing
 * the whole run. Requires a sensor + spacecraft; clears the result otherwise. Fails loud on bad input.
 */
export async function computeObservationSchedule(
  e: EngineCore,
  store: AppStore,
  isDisposed: () => boolean,
  spec: ObservationScheduleSpec = DEFAULT_OBSERVATION_SCHEDULE,
  constraints: AccessConstraintSpec = DEFAULT_ACCESS_CONSTRAINTS,
  opts: { spanSec?: number; stepSec?: number } = {},
): Promise<void> {
  const inst = e.instrument;
  const sc = e.identity.spacecraftName;
  const center = e.identity.centerBody;
  if (!inst || !sc || !center || !e.table.byBody.has(sc) || !e.table.byBody.has(center)) {
    store.setState({ observationSchedule: null });
    return;
  }
  if (spec.targets.length === 0) {
    throw new OpsAccessError('no observation targets: add at least one target to schedule');
  }
  const needsSun = spec.pointing === 'sun';
  const t0 = e.clock.state.et;
  const span: [number, number] = [t0, Math.min(t0 + (opts.spanSec ?? 86400), e.table.et1)];
  const step = opts.stepSec ?? 120;
  try {
    const halfAngle = fovHalfAngleRad(inst.fov.boresight, inst.fov.bounds);
    const labelled = assembleConstraints(constraints, center, activeStation(store.getState().scenario));
    const scheduleTargets: ScheduleTarget[] = [];
    // A target the geometry cannot place (the center body, an unsampled body, no Sun for sun-pointing,
    // or a SPICE access error) is carried as an empty-window target with a located reason, so one bad
    // target is reported as unscheduled rather than aborting the schedule. Spec errors still fail loud.
    const unavailable = (name: string, reason: string): ScheduleTarget => ({
      name,
      windows: [],
      attitude: [1, 0, 0, 0],
      unavailableReason: reason,
    });
    for (const name of spec.targets) {
      const gate =
        name === center
          ? 'target is the mission center body'
          : !e.table.byBody.has(name)
            ? 'target is not in the sampled ephemeris'
            : needsSun && !e.table.byBody.has('Sun')
              ? 'sun pointing needs the Sun sampled'
              : null;
      if (gate) {
        scheduleTargets.push(unavailable(name, gate));
        continue;
      }
      try {
        const { times, flags } = sweepFovFlags(e, spec.pointing, halfAngle, name, sc, center, span, step);
        const fovOnly = intervalsFromFlags(times, flags);
        const accessWindow = await computeAccess(e.spice, {
          observer: sc,
          target: name,
          span,
          step,
          constraints: labelled.map((l) => l.constraint),
        });
        const surviving = windowIntersect(fovOnly, accessWindow);
        // The attitude held while observing: boresight aligned to the line of sight at the first
        // surviving window start (or the span start when there is no window, an unused attitude then).
        const refEpoch = surviving.length > 0 ? surviving[0]![0] : span[0];
        scheduleTargets.push({ name, windows: surviving, attitude: boresightToLosQuat(losUnit(e, sc, name, refEpoch)) });
      } catch (perTargetErr) {
        scheduleTargets.push(unavailable(name, perTargetErr instanceof Error ? perTargetErr.message : String(perTargetErr)));
      }
    }
    const schedule = buildObservationSchedule(scheduleTargets, {
      maxRateDegPerSec: spec.maxRateDegPerSec,
      maxAccelDegPerSec2: spec.maxAccelDegPerSec2,
      minDwellSec: spec.minDwellSec,
    });
    const result: ObservationScheduleResult = {
      span,
      pointing: spec.pointing,
      slots: schedule.slots.map((s) => ({
        targetName: s.targetName,
        start: s.start,
        stop: s.stop,
        slewFromPrevDeg: s.slewFromPrevDeg,
        slewFromPrevSec: s.slewFromPrevSec,
      })),
      unscheduled: schedule.unscheduled.map((u) => ({ targetName: u.targetName, reason: u.reason })),
      label: `${inst.descriptor.name} multi-target schedule (${spec.pointing}-pointed)`,
    };
    if (!isDisposed()) store.setState({ observationSchedule: result });
  } catch (err) {
    if (!isDisposed()) store.setState({ observationSchedule: null });
    console.error('observation schedule failed', err);
    throw err;
  }
}
