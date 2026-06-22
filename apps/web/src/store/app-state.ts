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

/** The active tab in the consolidated Analyze dock. The six intent-named domain tabs of
 *  the analysis-UX re-slot (design section 3): Orbit & Maneuver (with OD folded in),
 *  Lighting & Geometry, Access & Comms, Conjunction, Coverage & Constellation, and the
 *  cross-cutting Report & Compare sink. */
export type AnalyzeTab =
  | 'orbit-maneuver'
  | 'lighting-geometry'
  | 'access-comms'
  | 'conjunction'
  | 'coverage'
  | 'report-compare';

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

/** A ground station in the scenario object model: a geodetic site the access, comms,
 *  and observation tasks point at by role. Angles are radians; altitude is km. */
export interface GroundStation {
  readonly id: string;
  readonly name: string;
  /** Geodetic longitude (radians, east-positive). */
  readonly lonRad: number;
  /** Geodetic latitude (radians, north-positive). */
  readonly latRad: number;
  /** Height above the reference ellipsoid (km). */
  readonly altKm: number;
  /** Minimum elevation mask (radians) below which the station has no access. */
  readonly minElevationRad?: number;
}

/** The editable spacecraft source the Orbit & Maneuver propagation tools read: a pasted
 *  two-line element set, or a loaded scene object picked by SPICE name. Replaces the former
 *  hardcoded bundled sample TLE (analysis-UX Phase 1). The display name mirrors into
 *  scenario.primarySpacecraft so other tabs share the same role-primary selection. */
export type SpacecraftSource =
  | { readonly kind: 'tle'; readonly name: string; readonly line1: string; readonly line2: string }
  | { readonly kind: 'object'; readonly name: string };

/** The typed Scenario Object Model: role SLOTS the analysis tasks read from instead of
 *  flat per-tool single-selects (design section 5, committed fix 1). A primary
 *  spacecraft, secondary object(s), a registry of ground stations with an active one,
 *  an observation target, and an asset SET (e.g. a designed constellation). Additive in
 *  Phase 0.1: the types and the empty default only; the context-bar controls and the
 *  per-card reads land in Phase 0.2. */
export interface ScenarioState {
  /** The role-primary spacecraft (the focus of most tasks), or null when unset. */
  readonly primarySpacecraft: string | null;
  /** The editable propagation source backing primarySpacecraft (a pasted TLE or a picked
   *  scene object), or null when no source is set (the Propagate card then shows a hint). */
  readonly spacecraftSource: SpacecraftSource | null;
  /** Secondary objects (e.g. a conjunction secondary, a comparison body). */
  readonly secondaryObjects: readonly string[];
  /** The ground-station registry the access/comms/observation tasks point at. */
  readonly stations: readonly GroundStation[];
  /** Which registered station is active for the station-bound tasks, or null. */
  readonly activeStationId: string | null;
  /** The body or target the observation tasks aim at, or null. */
  readonly observationTarget: string | null;
  /** The asset SET (e.g. constellation members) coverage tasks sweep over. */
  readonly assetSet: readonly string[];
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
  /** The typed scenario object model: the role slots the tasks read by role. */
  scenario: ScenarioState;
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
  /** Full umbra/penumbra/annular/sunlit eclipse phases from the last eclipse run. */
  eclipsePhases: EclipsePhasesResult | null;
  /** Beta-angle season series (deg + eclipse-onset threshold) from the last beta run. */
  betaSeries: BetaSeriesResult | null;
  /** Solar-intensity (visible-disk fraction, 0..1) series from the last intensity run. */
  solarIntensitySeries: Series | null;
  /** Range time series (spacecraft to center body) from the last range analysis. */
  rangeSeries: Series | null;
  /** Access windows from the last access-stack run (the surviving intersection of the
   *  enabled constraints). */
  accessResult: IntervalAnalysisResult | null;
  /** Per-constraint breakdown of the last access-stack run: each enabled constraint's
   *  figure of merit run alone, so the panel shows how each narrowed the span. */
  accessBreakdown: readonly AccessConstraintNote[] | null;
  /** Instrument-target-visibility windows (target within the selected-pointing FOV, the
   *  FOV-only geometry before the access constraints). */
  fovResult: IntervalAnalysisResult | null;
  /** The post-constraint surviving in-FOV window (FOV intersected with the access stack). */
  fovSurviving: IntervalAnalysisResult | null;
  /** Downlink Eb/N0 (dB) time series (spacecraft to Earth) from the last link run. */
  linkSeries: Series | null;
  /** The radio parameters the last link run used, for a reproducible CSV export. */
  linkParams: LinkBudgetParams | null;
  /** [ux-p2-access] Rise/set passes of the primary spacecraft over the ACTIVE ground station, by
   *  az/el mask, each with its max-elevation epoch (the station-passes card). Null until a run. */
  stationPasses: StationPassesResult | null;
  /** [ux-p2-access] The selected pass id the link worksheet binds to (active-selection: the passes
   *  card writes it, the worksheet card reads it), or null when no pass row is selected. */
  selectedPassId: string | null;
  /** [ux-p2-access] The itemized link-budget worksheet at the worst-case AND nominal elevation of
   *  the selected pass, plus the margin-vs-time series over the pass. Null until a run. */
  linkWorksheet: LinkWorksheetResult | null;
  /** [ux-p2-access] The selected consecutive pass pair the slew-feasibility card binds to (active-
   *  selection: the passes card writes the two pass ids), or null when no pair is selected. */
  selectedWindowPair: readonly [string, string] | null;
  /** [ux-p2-access] The eigen-axis slew-feasibility verdict between the selected pass pair's
   *  pointings (does the slew fit in the gap), or null until a run. */
  slewFeasibility: SlewFeasibilityResult | null;
  /** Closest-approach + collision-probability summary from the last conjunction run. */
  conjunction: ConjunctionResult | null;
  /** Off-main-thread all-vs-all catalog screening: status, progress, and flagged events. */
  screening: ScreeningState;
  /** Summary of the last REAL CDM/OEM/TLE ingestion into the screening catalog (Phase 1), or
   *  null until a catalog is ingested. */
  conjunctionIngest: ConjunctionIngestSummary | null;
  /** The per-event full-covariance Pc + B-plane result for the selected screened event, or
   *  null until an event is selected (or while it is being computed). */
  conjunctionEvent: ConjunctionEventResult | null;
  /** Walker constellation summary from the last coverage/constellation run. */
  constellation: ConstellationResult | null;
  /** The designed constellation as the swept ASSET SET (published SPK ids), or null until
   *  a Walker design publishes its members. The coverage sweep reads this for its assets. */
  designedConstellation: DesignedConstellation | null;
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

/** One member of an access-stack breakdown: a constraint's label and the figure of merit it
 *  admits run alone over the span, so the panel can show how much each constraint narrows. */
export interface AccessConstraintNote {
  readonly label: string;
  readonly fom: AccessFom;
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

/** Summary of a REAL CDM/OEM/TLE ingestion into the conjunction screening catalog. The
 *  catalog (and its per-object covariances) live on the engine; this is the panel readout. */
export interface ConjunctionIngestSummary {
  /** The ingested format. */
  readonly format: 'cdm' | 'oem' | 'tle';
  /** Number of objects ingested into the screening catalog. */
  readonly objectCount: number;
  /** Number of objects that carry a full covariance (CDM); 0 for OEM/TLE. */
  readonly covarianceCount: number;
  /** The object ids in the catalog, for the panel. */
  readonly ids: readonly string[];
  /** A short human note for the panel readout. */
  readonly note: string;
}

/** One screen-space ellipse (semi-axes in km, orientation in radians) for the B-plane plot. */
export interface BPlaneEllipseView {
  readonly sigma: number;
  readonly semiMajorKm: number;
  readonly semiMinorKm: number;
  readonly angleRad: number;
}

/** The per-event full-covariance Pc + B-plane result for one selected screened event. */
export interface ConjunctionEventResult {
  /** The selected event's index in the screened-events list (for the active-row highlight). */
  readonly index: number;
  readonly primaryId: string;
  readonly secondaryId: string;
  /** Time of closest approach (UTC seconds, the catalog time base). */
  readonly tca: number;
  /** Full-covariance Pc (Foster, combined STM-propagated covariance), or null when neither
   *  object carries a covariance (OEM/TLE catalog: only the max-Pc bound is available). */
  readonly pcFull: number | null;
  /** Maximum Pc (Alfano upper bound) for the projected miss + combined hard-body radius. */
  readonly pcMax: number;
  /** Projected encounter-plane miss (km), miss magnitude, combined radius, and the relative
   *  speed at TCA, for the readout. */
  readonly missXKm: number;
  readonly missYKm: number;
  readonly missKm: number;
  readonly radiusKm: number;
  readonly relSpeedKmS: number;
  /** Whether the full-covariance path used real per-object covariances. */
  readonly hasCovariance: boolean;
  /** The 1- and 3-sigma covariance ellipses (km, radians) for the B-plane plot; empty when
   *  no covariance is available. */
  readonly ellipses: readonly BPlaneEllipseView[];
  /** A symmetric half-extent (km) framing the plot. */
  readonly extentKm: number;
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

/** A designed Walker constellation surfaced as the swept ASSET SET: the published SPK
 *  asset ids the coverage sweep runs over, plus the structure for the rings/readout. The
 *  constellation designer FEEDS the sweep through this slice (design section 4, coverage
 *  planner: "renders as rings AND becomes the asset set"). */
export interface DesignedConstellation {
  /** The published asset SPK ids (one per Walker satellite) the sweep covers over. */
  readonly assetIds: readonly string[];
  readonly totalSats: number;
  readonly planes: number;
  readonly perPlane: number;
}

/** The selected figure-of-merit metric a coverage contour colors by (id + display). */
export interface CoverageMetricSelection {
  /** Metric id (matches the coverage-metric registry; kept as a string for the store). */
  readonly id: string;
  readonly label: string;
  /** Legend unit string (e.g. "%", "min"). */
  readonly unit: string;
  /** N-fold order k the metric/summary was computed for. */
  readonly nFoldK: number;
}

/** The regional aggregate FOM summary surfaced as a table + CSV (mirrors CoverageFomSummary). */
export interface CoverageFomSummaryState {
  readonly cellCount: number;
  readonly areaWeightedPercentCoverage: number;
  readonly minPercentCoverage: number;
  readonly meanPercentCoverage: number;
  readonly maxPercentCoverage: number;
  readonly worstRevisitMaxSec: number;
  readonly worstResponseTimeSec: number | null;
  readonly nFoldCellFraction: number;
  readonly nFoldK: number;
}

/** Summary of a coverage-grid overlay run (the overlay itself lives in the scene). */
export interface CoverageGridResult {
  /** Number of swept grid cells draped on the globe. */
  readonly cellCount: number;
  /** Area-weighted mean percent coverage across the grid, in [0, 1]. */
  readonly areaWeightedPercentCoverage: number;
  readonly label: string;
  /** The number of assets swept (the designed asset set size, or 1 for the single asset). */
  readonly assetCount: number;
  /** The metric the contour colored by (legend name + units), present on a sweep run. */
  readonly metric: CoverageMetricSelection | null;
  /** The regional aggregate FOM summary (the FOM table + CSV source), or null. */
  readonly summary: CoverageFomSummaryState | null;
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

/** Beta-angle season series (deg over the span) plus the body's eclipse-onset
 *  threshold: the satellite is in eclipse season while |beta| < onsetDeg. */
export interface BetaSeriesResult {
  /** Beta angle (deg) over time; et aligned to valueDeg. */
  readonly series: Series;
  /** Eclipse-onset half-angle (deg): |beta| below this puts the orbit in eclipse season. */
  readonly onsetDeg: number;
  readonly span: readonly [number, number];
}

/** Full eclipse phase windows over a span: the four mutually exclusive conditions
 *  (umbra/penumbra/annular/sunlit) plus the total per-day shadowed duration. */
export interface EclipsePhasesResult {
  readonly umbra: readonly (readonly [number, number])[];
  readonly penumbra: readonly (readonly [number, number])[];
  readonly annular: readonly (readonly [number, number])[];
  readonly sunlit: readonly (readonly [number, number])[];
  readonly span: readonly [number, number];
  /** Total shadowed (umbra + penumbra + annular) seconds per mean day over the span. */
  readonly shadowSecPerDay: number;
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

/** [ux-p2-access] One rise/set pass of the spacecraft over a ground station, with the slant range
 *  and elevation at its max-elevation epoch. A pass row is the active-selection unit the worksheet
 *  and slew cards bind to (selectedPassId / selectedWindowPair). */
export interface StationPass {
  /** A stable id for the pass row (active-selection key + testid suffix), e.g. 'pass-0'. */
  readonly id: string;
  /** Rise (start) and set (stop) of the pass, ET seconds. */
  readonly rise: number;
  readonly set: number;
  /** Epoch (ET seconds) of maximum elevation within the pass. */
  readonly maxElevationEpoch: number;
  /** Maximum elevation in the pass (radians). */
  readonly maxElevationRad: number;
  /** Slant range (km) and elevation (radians) at the max-elevation epoch, the worksheet nominal. */
  readonly maxElevationRangeKm: number;
  /** Slant range (km) and elevation (radians) at the worst-case (lowest-elevation pass edge). */
  readonly worstElevationRad: number;
  readonly worstElevationRangeKm: number;
}

/** [ux-p2-access] Az/el-masked station passes of the spacecraft over the active station. */
export interface StationPassesResult {
  /** The active station's display name + body, for the readout. */
  readonly stationName: string;
  /** The spacecraft (or propagated body) the passes are computed for. */
  readonly spacecraft: string;
  readonly span: readonly [number, number];
  readonly passes: readonly StationPass[];
  readonly fom: AccessFom;
  readonly label: string;
}

/** [ux-p2-access] One row of the assembled link worksheet (mirrors link-worksheet.WorksheetLine). */
export interface LinkWorksheetLine {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

/** [ux-p2-access] The worksheet at one geometry case (worst-case or nominal elevation of the pass):
 *  the itemized lines plus the rolled-up Eb/N0 and margin. */
export interface LinkWorksheetCase {
  readonly caseLabel: string;
  readonly elevationDeg: number;
  readonly rangeKm: number;
  readonly lines: readonly LinkWorksheetLine[];
  readonly ebN0Db: number;
  readonly requiredEbN0Db: number;
  readonly marginDb: number;
}

/** [ux-p2-access] The full link-budget worksheet bound to the selected pass: a worst-case and a
 *  nominal case, the selected MODCOD name, and a margin-vs-time series over the pass with the
 *  required-Eb/N0 threshold drawn. When no pass is selected the geometry is a representative note. */
export interface LinkWorksheetResult {
  /** The selected pass id the worksheet bound to, or null when a representative geometry was used. */
  readonly passId: string | null;
  readonly modcodName: string;
  readonly requiredEbN0Db: number;
  readonly worstCase: LinkWorksheetCase;
  readonly nominal: LinkWorksheetCase;
  /** Margin (dB) over the pass for the margin-vs-time chart; et aligned to marginDb. */
  readonly marginSeries: Series;
  /** A short note (e.g. "representative geometry: no pass selected"), or '' when bound to a pass. */
  readonly note: string;
  readonly label: string;
}

/** [ux-p2-access] The eigen-axis slew-feasibility verdict between two consecutive passes. */
export interface SlewFeasibilityResult {
  readonly fromPassId: string;
  readonly toPassId: string;
  /** The pointing mode the two attitudes were resolved under ('targetTrack' or 'inertial'). */
  readonly mode: 'targetTrack' | 'inertial';
  readonly slewAngleDeg: number;
  readonly slewDurationSec: number;
  readonly gapSec: number;
  readonly slackSec: number;
  readonly fits: boolean;
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
  /** Per-iteration corrector residual norm (the convergence trace), empty when none ran. */
  readonly residualHistory: readonly { readonly iter: number; readonly normF: number }[];
  /** The solved prograde delta-v magnitude (km/s) the corrector found, or null when none ran. */
  readonly solvedDvKmS: number | null;
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
  analyzeTab: 'orbit-maneuver',
  analysisContext: { spanSec: 86400, stepSec: 120, target: '', observer: '', frame: 'J2000' },
  scenario: {
    primarySpacecraft: null,
    spacecraftSource: null,
    secondaryObjects: [],
    stations: [],
    activeStationId: null,
    observationTarget: null,
    assetSet: [],
  },
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
  eclipsePhases: null,
  betaSeries: null,
  solarIntensitySeries: null,
  rangeSeries: null,
  accessResult: null,
  accessBreakdown: null,
  fovResult: null,
  fovSurviving: null,
  linkSeries: null,
  linkParams: null,
  stationPasses: null,
  selectedPassId: null,
  linkWorksheet: null,
  selectedWindowPair: null,
  slewFeasibility: null,
  conjunction: null,
  screening: INITIAL_SCREENING,
  conjunctionIngest: null,
  conjunctionEvent: null,
  constellation: null,
  designedConstellation: null,
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
