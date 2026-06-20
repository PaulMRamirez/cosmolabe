// The single typed state tree for the web viewer. It collapses the ~25 useState
// values the monolithic viewer carried (plus the playing/rate/instruments/track
// mirror refs) into one object that both React (via useStore) and the imperative
// BesselEngine (via getState/setState) share.

import type { CatalogEntry, Readouts, VisualizationSettings } from '@bessel/ui';
import type { PredictedVsActual } from '@bessel/state';
import type { TimelineAnnotation } from '@bessel/timeline';
import { DEFAULT_OBJECT_ENTRIES } from '../catalog-load.ts';
import type { Bookmark } from '../bookmarks.ts';
import { createStore, type Store } from './create-store.ts';

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
  // Camera and selection.
  focus: string;
  selection: readonly string[];
  track: boolean;
  /** Base camera mode; spacecraft tracking overrides it while active. */
  cameraMode: 'orbit' | 'sync' | 'free';
  /** Eclipse (umbra) intervals from the last lighting analysis, with their span. */
  eclipseUmbra: readonly (readonly [number, number])[] | null;
  eclipseSpan: readonly [number, number] | null;
  /** Range time series (spacecraft to center body) from the last range analysis. */
  rangeSeries: Series | null;
  /** Line-of-sight access windows (spacecraft to the Sun) from the last access run. */
  accessWindow: readonly (readonly [number, number])[] | null;
  accessSpan: readonly [number, number] | null;
  accessLabel: string;
  /** Figure-of-merit reduction of the access window (coverage %, gaps), or null. */
  accessFom: AccessFom | null;
  /** Downlink Eb/N0 (dB) time series (spacecraft to Earth) from the last link run. */
  linkSeries: Series | null;
  /** Closest-approach + collision-probability summary from the last conjunction run. */
  conjunction: ConjunctionResult | null;
  /** Walker constellation summary from the last coverage/constellation run. */
  constellation: ConstellationResult | null;
  /** Eigen-axis slew angle (deg) over time from the last attitude run. */
  slewSeries: Series | null;
  /** Lambert transfer summary (delta-v) from the last maneuver-design run. */
  transfer: TransferResult | null;
  /** Sub-spacecraft ground track (lon/lat radians) from the last ground-track run. */
  groundTrack: GroundTrack | null;
  /** SGP4-propagated TLE orbit (altitude series + ground track) from the last run. */
  tleOrbit: TleOrbit | null;
  /** Ground-station visible-pass windows (elevation mask intersected with sunlit). */
  stationAccess: StationAccess | null;
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
  // Layers and per-object visibility.
  settings: VisualizationSettings;
  visibility: Readonly<Record<string, boolean>>;
  // Readouts and chrome.
  readouts: Readouts;
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
  readonly label: string;
}

export interface ConstellationResult {
  readonly totalSats: number;
  readonly planes: number;
  readonly perPlane: number;
  readonly pattern: 'delta' | 'star';
  /** Inclination (deg) and altitude (km) of the generated Walker pattern. */
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
}

export interface TransferResult {
  /** Total impulsive delta-v of the Lambert transfer (km/s). */
  readonly deltaVKmS: number;
  /** Departure-to-arrival time of flight (hours). */
  readonly tofHours: number;
  readonly label: string;
}

export interface GroundTrack {
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

export interface StationAccess {
  /** Visible-pass intervals (ET seconds): above the elevation mask and sunlit. */
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
  // Default to a heliocentric whole-system view; a loaded mission recenters on
  // its own center body.
  focus: 'Sun',
  selection: [],
  track: false,
  cameraMode: 'orbit',
  eclipseUmbra: null,
  eclipseSpan: null,
  rangeSeries: null,
  accessWindow: null,
  accessSpan: null,
  accessLabel: '',
  accessFom: null,
  linkSeries: null,
  conjunction: null,
  constellation: null,
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
  },
  visibility: {},
  readouts: {
    rangeKm: null,
    altitudeKm: null,
    phaseDeg: null,
    incidenceDeg: null,
    emissionDeg: null,
  },
  helpOpen: false,
  recording: false,
  theme: 'dark',
  objects: DEFAULT_OBJECT_ENTRIES,
  loadedName: null,
  loadError: null,
  measurement: null,
  telemetryResidualKm: null,
  telemetryOverlay: [],
  telemetryFault: null,
  annotations: [],
  spacecraftQuat: null,
  bookmarks: [],
};

export type AppStore = Store<AppState>;

export function createAppStore(): AppStore {
  return createStore<AppState>(initialAppState);
}
