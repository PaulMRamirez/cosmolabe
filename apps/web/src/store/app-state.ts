// The single typed state tree for the web viewer. It collapses the ~25 useState
// values the monolithic viewer carried (plus the playing/rate/instruments/track
// mirror refs) into one object that both React (via useStore) and the imperative
// BesselEngine (via getState/setState) share.

import type { BodyState, CatalogEntry, Readouts, TimeSystem, VisualizationSettings } from '@bessel/ui';
import type { PredictedVsActual } from '@bessel/state';
import type { TimelineAnnotation } from '@bessel/timeline';
import { DEFAULT_OBJECT_ENTRIES } from '../catalog-load.ts';
import type { Bookmark } from '../bookmarks.ts';
import type { SavedScript } from '../scripts.ts';
import { INITIAL_SCREENING, type ScreeningState } from '../screening-protocol.ts';
import { createStore, type Store } from './create-store.ts';

/** The active tab in the consolidated Analyze dock. */
export type AnalyzeTab = 'propagation' | 'maneuver' | 'od' | 'access' | 'report' | 'compare';

/** Per-tool run status: a compute action is idle, running, succeeded, or failed loudly. */
export type RunStatus = 'idle' | 'running' | 'ok' | { readonly error: string };

/** A kept analysis result snapshot, for side-by-side trade comparison. */
export interface KeptSnapshot {
  readonly id: string;
  /** The tool the snapshot came from (access | conjunction | link); compared same-tool. */
  readonly tool: string;
  readonly name: string;
  readonly metrics: readonly { readonly label: string; readonly value: string }[];
}

/** Maximum number of kept snapshots in the compare tray. */
export const KEPT_SNAPSHOT_LIMIT = 4;

/** Shared analysis parameters that every analysis tab reads by default (a tool can
 *  override locally). The run epoch is not held here: it is the live timeline epoch,
 *  so every tool already shares it; this slice holds the span, grid, and pointing. */
export interface AnalysisContext {
  readonly spanSec: number;
  readonly stepSec: number;
  /** '' means the tool default (center body / Sun). */
  readonly target: string;
  /** '' means the tool default. */
  readonly observer: string;
  /** Validated SPICE frame name; free entry is allowed and fails loudly at run. */
  readonly frame: string;
}

export interface AppState {
  // Lifecycle.
  status: string;
  ready: boolean;
  // Playback and time.
  playing: boolean;
  rate: number;
  et: number;
  bounds: readonly [number, number];
  epochLabel: string;
  /** Formatted [start, end] of the loaded window (active time system), for the scrub
   *  track end labels; null until first computed. */
  boundsLabel: readonly [string, string] | null;
  /** Time system the epoch label is displayed in (display only; et stays TDB seconds). */
  timeSystem: TimeSystem;
  /** Whether the consolidated Analyze dock (right panel) is open. */
  analyzeOpen: boolean;
  /** The active tab in the Analyze dock. */
  analyzeTab: AnalyzeTab;
  /** Shared analysis parameters the dock's tabs read by default. */
  analysisContext: AnalysisContext;
  /** True once the first-run welcome card has been dismissed or acted on (persisted). */
  welcomeSeen: boolean;
  /** A loud go-to-epoch parse error to surface next to the field, or null. */
  timelineError: string | null;
  /** Per-tool run status keyed by the tool's action id (= its button data-testid). */
  runStatus: Readonly<Record<string, RunStatus>>;
  /** Kept analysis snapshots shown in the compare tray. */
  keptSnapshots: readonly KeptSnapshot[];
  // Camera and selection.
  focus: string;
  selection: readonly string[];
  track: boolean;
  /** Base camera mode; spacecraft tracking overrides it while active. */
  cameraMode: 'orbit' | 'sync' | 'free' | 'frame';
  /** The SPICE frame the camera basis locks to in 'frame' mode (e.g. IAU_EARTH). */
  cameraFrame: string;
  /** Eclipse (umbra) intervals from the last lighting analysis, with their span. */
  eclipseUmbra: readonly (readonly [number, number])[] | null;
  eclipseSpan: readonly [number, number] | null;
  /** Range time series (spacecraft to center body) from the last range analysis. */
  rangeSeries: Series | null;
  /** Line-of-sight access windows (spacecraft to the Sun) from the last access run. */
  accessResult: IntervalAnalysisResult | null;
  /** Instrument-target-visibility windows (target within the nadir-pointed FOV). */
  fovResult: IntervalAnalysisResult | null;
  /** Downlink Eb/N0 (dB) time series (spacecraft to Earth) from the last link run. */
  linkSeries: Series | null;
  /** The radio parameters the last link run used, for a reproducible CSV export. */
  linkParams: LinkBudgetParams | null;
  /** Closest-approach + collision-probability summary from the last conjunction run. */
  conjunction: ConjunctionResult | null;
  /** Off-main-thread all-vs-all catalog screening: status, progress, and flagged events. */
  screening: ScreeningState;
  /** Walker constellation summary from the last coverage/constellation run. */
  constellation: ConstellationResult | null;
  /** Summary of the last coverage-grid overlay run (cell count + area-weighted FOM). */
  coverageGrid: CoverageGridResult | null;
  /** Eigen-axis slew angle (deg) over time from the last attitude run. */
  slewSeries: Series | null;
  /** Lambert transfer summary (delta-v) from the last maneuver-design run. */
  transfer: TransferResult | null;
  /** Sub-spacecraft ground track (lon/lat radians) from the last ground-track run. */
  groundTrack: GroundTrack | null;
  /** SGP4-propagated TLE orbit (altitude series + ground track) from the last run. */
  tleOrbit: TleOrbit | null;
  /** Ground-station visible-pass windows (elevation mask intersected with sunlit). */
  stationAccess: IntervalAnalysisResult | null;
  /** Altitude (km) from a numerical (HPOP, 2-body + J2) propagation of the TLE state. */
  hpopAltitude: Series | null;
  /** Result of the last Mission Control Sequence (MCS) design run, or null. */
  mcsResult: McsResult | null;
  /** Result of the last batch-least-squares orbit-determination run, or null. */
  odResult: OdResult | null;
  /** The last data-provider workbench report (table + raw series for CSV export). */
  report: ReportResult | null;
  // Instruments.
  instruments: boolean;
  footprintPoints: number;
  fovOk: boolean;
  /** Names of every resolved instrument, for the selector (empty or single hides it). */
  instrumentNames: readonly string[];
  /** The active instrument name driving FOV/footprint, or null when none. */
  activeInstrumentId: string | null;
  /** True when the rendered scene drew at least one image-textured ring. */
  ringTextured: boolean;
  /** True when the rendered scene built at least one translucent cloud shell. */
  cloudShell: boolean;
  /** True once real fetched imagery has been applied to at least one body. */
  realImageryApplied: boolean;
  // Layers and per-object visibility.
  settings: VisualizationSettings;
  visibility: Readonly<Record<string, boolean>>;
  // Readouts and chrome.
  readouts: Readouts;
  // State vectors and osculating elements for the focused body (null when n/a), in
  // the selected SPICE frame.
  bodyState: BodyState | null;
  stateFrame: string;
  helpOpen: boolean;
  recording: boolean;
  // Theme: persisted to the document via data-theme.
  theme: 'dark' | 'light';
  // Catalog: the object list (catalog-driven) and load status.
  objects: readonly CatalogEntry[];
  loadedName: string | null;
  loadError: string | null;
  // Measurement: distance between the first two selected objects.
  measurement: Measurement | null;
  // Measure mode: when on, a canvas click adds to the measured pair (rolling two)
  // instead of recentering, so two clicks measure between two bodies.
  measureMode: boolean;
  // Telemetry: latest predicted-versus-actual residual (km), or null.
  telemetryResidualKm: number | null;
  /** Full predicted-versus-actual series for the on-screen telemetry overlay. */
  telemetryOverlay: readonly PredictedVsActual[];
  /** Loud telemetry-transport fault from the adapter, surfaced as a banner. */
  telemetryFault: string | null;
  /** Mission timeline annotations (arc boundaries + SPICE-found events). */
  annotations: readonly TimelineAnnotation[];
  /** Applied spacecraft attitude quaternion [x,y,z,w], or null when none. */
  spacecraftQuat: readonly [number, number, number, number] | null;
  // Saved views.
  bookmarks: readonly Bookmark[];
  // Named scripts persisted through PAL Storage, for the scripting console.
  savedScripts: readonly SavedScript[];
}

export interface Series {
  /** Sample epochs (ET seconds) and the measured quantity at each (km, dB, ...). */
  readonly et: Float64Array;
  readonly value: Float64Array;
  /** What the series measures, for the panel label (e.g. "Cassini to Saturn (km)"). */
  readonly label: string;
}

export interface AccessFom {
  /** Covered fraction of the span, in [0, 1]. */
  readonly percentCoverage: number;
  readonly accessCount: number;
  readonly maxGapSec: number;
}

export interface ConjunctionResult {
  /** Time of closest approach relative to the current epoch (s). */
  readonly tcaSec: number;
  readonly missKm: number;
  readonly relSpeedKmS: number;
  /** 2D probability of collision under an assumed covariance and hard-body radius. */
  readonly pc: number;
  /** Per-axis position sigma (km) the Pc was computed against, for a faithful export. */
  readonly sigmaKm: number;
  /** Combined hard-body radius (km) the Pc was computed against. */
  readonly radiusKm: number;
  readonly label: string;
}

/** The downlink-radio parameters a link-budget run used, kept so the CSV records them. */
export interface LinkBudgetParams {
  readonly eirpDbW: number;
  readonly freqHz: number;
  readonly gOverTDbK: number;
  readonly dataRateBps: number;
}

export interface ConstellationResult {
  readonly totalSats: number;
  readonly planes: number;
  readonly perPlane: number;
  readonly pattern: 'delta' | 'star';
  /** Inter-plane phasing factor F of the Walker T/P/F pattern. */
  readonly phasing: number;
  /** Inclination (deg) and altitude (km) of the generated Walker pattern. */
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
}

/** Summary of a coverage-grid overlay run (the overlay itself lives in the scene). */
export interface CoverageGridResult {
  /** Number of swept grid cells draped on the globe. */
  readonly cellCount: number;
  /** Area-weighted mean percent coverage across the grid, in [0, 1]. */
  readonly areaWeightedPercentCoverage: number;
  readonly label: string;
}

export interface TransferResult {
  /** Total impulsive delta-v of the Lambert transfer (km/s). */
  readonly deltaVKmS: number;
  /** Departure-to-arrival time of flight (hours). */
  readonly tofHours: number;
  readonly label: string;
}

export interface GroundTrack {
  /** Sample epochs (ET seconds), aligned to lon/lat, for time-stamped export. */
  readonly et: Float64Array;
  /** Sub-spacecraft longitude and latitude samples (radians). */
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly label: string;
}

export interface ReportResult {
  /** Column headers (with units), e.g. ["UTC", "range (km)"]. */
  readonly headers: readonly string[];
  /** Display rows (downsampled): a UTC label plus the column values. */
  readonly rows: readonly (readonly (string | number)[])[];
  /** The full series backing the report, for CSV export. */
  readonly series: { readonly et: Float64Array; readonly columns: Float64Array[]; readonly names: string[] };
  readonly label: string;
}

/** One interval-analysis result: visibility/access windows over a span, reduced to a
 *  figure of merit, with a human label. Shared by the access, in-FOV, and ground-station
 *  tools so the result shape (and its reset/render paths) cannot drift between them. */
export interface IntervalAnalysisResult {
  /** Interval pairs (ET seconds), e.g. line-of-sight passes or in-FOV windows. */
  readonly window: readonly (readonly [number, number])[];
  readonly span: readonly [number, number];
  readonly fom: AccessFom;
  readonly label: string;
}

export interface TleOrbit {
  /** Altitude above the Earth ellipsoid over one day (km vs ET). */
  readonly altitude: Series;
  /** Sub-satellite ground track (lon/lat radians) over one day. */
  readonly track: GroundTrack;
  /** Orbit period (minutes) from the TLE mean motion. */
  readonly periodMin: number;
  readonly label: string;
}

export interface McsGoalReport {
  /** Goal type label (e.g. "Radius", "Altitude"). */
  readonly type: string;
  readonly achieved: number;
  readonly desired: number;
  readonly residual: number;
  readonly satisfied: boolean;
}

export interface McsResult {
  /** Final position (km) and speed (km/s) of the propagated sequence. */
  readonly finalRadiusKm: number;
  readonly finalSpeedKmS: number;
  /** Final epoch (ET seconds). */
  readonly finalEpoch: number;
  /** Altitude (km) along the propagated arc, for a chart. */
  readonly altitude: Series;
  /** Whether the differential corrector converged (null when no target segment ran). */
  readonly converged: boolean | null;
  /** Iterations the differential corrector took (0 when none ran). */
  readonly iterations: number;
  /** Per-goal residual reports from the differential corrector. */
  readonly goals: readonly McsGoalReport[];
  readonly label: string;
}

export interface OdResult {
  /** Estimated 6-state [x, y, z, vx, vy, vz] (km, km/s) at the solve epoch. */
  readonly estimate: readonly number[];
  /** Position error (km) of the estimate against the synthetic truth. */
  readonly positionErrorKm: number;
  /** Velocity error (km/s) of the estimate against the synthetic truth. */
  readonly velocityErrorKmS: number;
  /** Post-fit residual RMS (sigma-normalized, dimensionless). */
  readonly residualRms: number;
  /** Gauss-Newton iterations performed. */
  readonly iterations: number;
  /** Scalar measurement components fitted. */
  readonly observationCount: number;
  /** One-sigma position uncertainties (km) from the covariance diagonal. */
  readonly sigmaPositionKm: readonly [number, number, number];
  readonly label: string;
}

export interface Measurement {
  readonly from: string;
  readonly to: string;
  readonly distanceKm: number;
  /** Range rate (km/s): negative is closing, positive is separating, or null. */
  readonly relativeSpeedKmS: number | null;
  /** Angular separation of the pair seen from the spacecraft, or null. */
  readonly angleDeg: number | null;
}

export const initialAppState: AppState = {
  status: 'Initializing',
  ready: false,
  playing: false,
  rate: 86400,
  et: 0,
  bounds: [0, 1],
  epochLabel: '',
  boundsLabel: null,
  timeSystem: 'UTC',
  analyzeOpen: false,
  analyzeTab: 'access',
  analysisContext: { spanSec: 86400, stepSec: 120, target: '', observer: '', frame: 'J2000' },
  welcomeSeen: false,
  timelineError: null,
  runStatus: {},
  keptSnapshots: [],
  // Default to a heliocentric whole-system view; a loaded mission recenters on
  // its own center body.
  focus: 'Sun',
  selection: [],
  track: false,
  cameraMode: 'orbit',
  cameraFrame: 'IAU_EARTH',
  eclipseUmbra: null,
  eclipseSpan: null,
  rangeSeries: null,
  accessResult: null,
  fovResult: null,
  linkSeries: null,
  linkParams: null,
  conjunction: null,
  screening: INITIAL_SCREENING,
  constellation: null,
  coverageGrid: null,
  slewSeries: null,
  transfer: null,
  groundTrack: null,
  tleOrbit: null,
  stationAccess: null,
  hpopAltitude: null,
  mcsResult: null,
  odResult: null,
  report: null,
  instruments: false,
  footprintPoints: 0,
  fovOk: false,
  instrumentNames: [],
  activeInstrumentId: null,
  ringTextured: false,
  cloudShell: false,
  realImageryApplied: false,
  settings: {
    trajectory: true,
    orbits: true,
    labels: true,
    fov: true,
    footprint: true,
    axes: true,
    stars: true,
    atmosphere: false,
    shadows: false,
    realImagery: false,
  },
  visibility: {},
  readouts: {
    rangeKm: null,
    altitudeKm: null,
    phaseDeg: null,
    incidenceDeg: null,
    emissionDeg: null,
  },
  bodyState: null,
  stateFrame: 'J2000',
  helpOpen: false,
  recording: false,
  theme: 'dark',
  objects: DEFAULT_OBJECT_ENTRIES,
  loadedName: null,
  loadError: null,
  measurement: null,
  measureMode: false,
  telemetryResidualKm: null,
  telemetryOverlay: [],
  telemetryFault: null,
  annotations: [],
  spacecraftQuat: null,
  bookmarks: [],
  savedScripts: [],
};

export type AppStore = Store<AppState>;

export function createAppStore(): AppStore {
  return createStore<AppState>(initialAppState);
}
