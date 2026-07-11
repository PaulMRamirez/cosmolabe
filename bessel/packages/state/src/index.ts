// @bessel/state: the view model and its URL serialization (SPEC 5.5, ADR-0008).
// A view encodes to a compact URL fragment and decodes back exactly, the basis
// for shareable links. The epoch is stored as ISO 8601 UTC so the fragment is
// human-meaningful and round-trips losslessly without a SPICE conversion here.

export type CameraMode = 'orbit' | 'center' | 'track';

export interface CameraPose {
  readonly mode: CameraMode;
  readonly target?: string;
  readonly distance: number;
  readonly azimuth: number;
  readonly elevation: number;
}

export interface ViewModel {
  /** Epoch as ISO 8601 UTC. */
  readonly t: string;
  readonly camera: CameraPose;
  readonly selection: readonly string[];
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly plugins: readonly string[];
}

export const VIEW_VERSION = 1;

export const DEFAULT_VIEW: ViewModel = {
  t: '2004-07-01T00:00:00Z',
  camera: { mode: 'orbit', distance: 1, azimuth: 0, elevation: 0 },
  selection: [],
  visibility: {},
  plugins: [],
};

export { encodeView, decodeView } from './codec.ts';

// Suite integrations (ADR-0008): the outbound MMGIS deep link and the CZML export.
// These are intentionally kept in @bessel/state rather than a separate
// @bessel/integrations package: both are pure functions over the @bessel/state
// view model and trajectory types and are covered by state.test.ts, so extracting
// a package would be naming churn with dependency-rule and bundle risk for no
// behavioral gain. They are grouped here as the suite-contract surface.
export { buildMmgisUrl, type MmgisHandoff, type MmgisMissionConfig } from './mmgis.ts';
export { exportCzml, CzmlError, type CzmlOptions, type CzmlSample } from './czml.ts';

// Real-time telemetry adapter (Phase 4): predicted-versus-actual overlay from a
// WebSocket-like source. Pure over the socket and a predictor.
export {
  TelemetryAdapter,
  TelemetryError,
  OVERLAY_HISTORY_LIMIT,
  parseTelemetryMessage,
  residualKm,
  type SocketLike,
  type TelemetrySample,
  type PredictedVsActual,
  type Vec3,
} from './telemetry.ts';
