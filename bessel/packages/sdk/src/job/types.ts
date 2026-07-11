// The canonical Bessel batch-job IR: a fully serializable discriminated union that an
// authored JSON file parses into and the programmatic builder emits. Types only, no
// logic. Execution lives in the runner; validation in validate.ts. (STK_PARITY_SPEC, SDK.)

import type { Mcs } from '@bessel/propagator';
import type { OemMetadata } from '@bessel/interop';

export interface BatchJob {
  readonly besselBatch: '1';
  readonly meta?: { readonly name?: string; readonly description?: string };
  readonly defaults?: JobDefaults;
  readonly entities?: Readonly<Record<string, EntityDecl>>;
  readonly operations: readonly Operation[];
  readonly output: OutputDecl;
}

export interface JobDefaults {
  readonly frame?: string; // default 'J2000'
  readonly center?: string; // default 'EARTH'
}

export interface OutputDecl {
  readonly dir: string;
  /** Stop the run on the first op failure, or continue and report. Default 'stop'. */
  readonly onError?: 'stop' | 'continue';
}

/** A sampling grid: a uniform UTC span, or explicit UTC epochs. */
export type GridSpec =
  | { readonly start: string; readonly stop: string; readonly stepSec: number }
  | { readonly epochs: readonly string[] };

export type EntityDecl = { readonly type: 'satellite'; readonly source: SatelliteSource };

export type SatelliteSource =
  | { readonly kind: 'spk'; readonly target: string }
  | { readonly kind: 'tle'; readonly line1: string; readonly line2: string }
  | {
      readonly kind: 'state';
      readonly epoch: string; // UTC ISO
      readonly centralBody: number; // NAIF id
      readonly r: readonly [number, number, number]; // km
      readonly v: readonly [number, number, number]; // km/s
    };

export type Operation =
  | FurnishOp
  | PropagateOp
  | RunMcsOp
  | AnalyzeOp
  | AnalyzeEclipseOp
  | AnalyzeAccessOp
  | AnalyzeLinkBudgetOp
  | LoadCatalogOp
  | ReportOp
  | ExportOemOp
  | ExportCsvOp;

export interface FurnishOp {
  readonly op: 'furnish';
  readonly id?: string;
  readonly names: readonly string[];
}

export interface PropagateOp {
  readonly op: 'propagate';
  readonly id: string;
  /** Entity id (satellite) to propagate. */
  readonly object: string;
  readonly method: 'sgp4' | 'twobody';
  readonly grid: GridSpec;
  readonly frame?: string;
  readonly center?: string;
  /** Optionally publish the arc into the kernel pool so later ops can query it. */
  readonly publishAs?: { readonly naifId: number; readonly degree?: number };
}

export interface RunMcsOp {
  readonly op: 'runMcs';
  readonly id: string;
  readonly mcs: Mcs; // @bessel/propagator IR, verbatim
  /** Per-NAIF-body dynamics for the mission environment (gm, bodyRadius). */
  readonly bodies?: Readonly<Record<number, { readonly gm: number; readonly bodyRadius: number }>>;
  readonly center?: string;
}

export interface AnalyzeOp {
  readonly op: 'analyze';
  readonly id: string;
  readonly kind: 'range';
  readonly observer: string;
  readonly target: string;
  readonly grid: GridSpec;
  readonly frame?: string;
}

/**
 * Eclipse (umbra) interval analysis over a grid: occultation of the Sun by a body, as
 * seen from the observer, reduced to an interval window. Delegates to @bessel/events.
 */
export interface AnalyzeEclipseOp {
  readonly op: 'analyzeEclipse';
  readonly id: string;
  /** Observer (satellite/spacecraft) SPICE id or name. */
  readonly observer: string;
  /** Eclipsing central body (e.g. "EARTH", "SATURN"). */
  readonly body: string;
  /** Body-fixed frame of the eclipsing body; defaults to IAU_<body>. */
  readonly bodyFrame?: string;
  readonly grid: GridSpec;
  /** Which eclipse condition's intervals to publish; defaults to 'umbra'. */
  readonly condition?: 'umbra' | 'penumbra' | 'annular' | 'sunlit';
}

/**
 * Line-of-sight visibility access over a grid, with an optional ground-facility
 * elevation mask and an optional range gate, reduced to an interval window. Delegates
 * to @bessel/access (computeAccess / computeElevationAccess).
 */
export interface AnalyzeAccessOp {
  readonly op: 'analyzeAccess';
  readonly id: string;
  /** Observing body/spacecraft (SPICE id or name). */
  readonly observer: string;
  /** Observed target (SPICE id or name). */
  readonly target: string;
  readonly grid: GridSpec;
  /** Occulting body for a line-of-sight constraint; defaults to the job center. */
  readonly losBody?: string;
  /** Body-fixed frame of the occulting body; defaults to IAU_<losBody>. */
  readonly losBodyFrame?: string;
  /** A ground facility (with an elevation mask) the observer must rise above. */
  readonly facility?: {
    readonly body: string;
    readonly bodyFrame: string;
    readonly lonDeg: number;
    readonly latDeg: number;
    readonly altKm: number;
    readonly minElevationDeg: number;
  };
  /** Observer-to-target range gate (km), intersected with the access window. */
  readonly maxRangeKm?: number;
  readonly minRangeKm?: number;
}

/**
 * Link-budget series over a grid: observer-to-target range from the engine, fed to
 * @bessel/rf for a per-epoch (range, pathLoss, ebN0, margin) series.
 */
export interface AnalyzeLinkBudgetOp {
  readonly op: 'analyzeLinkBudget';
  readonly id: string;
  /** Transmitter (spacecraft) SPICE id or name; the link origin. */
  readonly observer: string;
  /** Receiver (e.g. "EARTH") SPICE id or name; range is observer-to-target. */
  readonly target: string;
  readonly grid: GridSpec;
  readonly frame?: string;
  /** Radio parameters fed to the @bessel/rf link budget per epoch. */
  readonly radio: {
    readonly eirpDbW: number;
    readonly freqHz: number;
    readonly gOverTDbK: number;
    readonly dataRateBps: number;
    readonly otherLossesDb?: number;
    readonly requiredEbN0Db?: number;
  };
}

/**
 * Load a Cosmographia catalog (read as text through the RunIo) and furnish the kernels
 * it references. Bridges an authored catalog into the headless run.
 */
export interface LoadCatalogOp {
  readonly op: 'loadCatalog';
  readonly id?: string;
  /** Catalog file path resolved through the RunIo readText seam. */
  readonly file: string;
}

/**
 * Reduce a set of prior producer results to a canonical JSON summary file: a stable,
 * sorted-key digest of each named producer (its kind and headline metrics).
 */
export interface ReportOp {
  readonly op: 'report';
  readonly id?: string;
  /** Producer ids to summarize; in declared order. */
  readonly from: readonly string[];
  readonly file: string;
}

export interface ExportOemOp {
  readonly op: 'exportOem';
  readonly id?: string;
  /** Producer id of an ephemeris or MCS result. */
  readonly from: string;
  readonly file: string;
  readonly metadata?: OemMetadata;
}

export interface ExportCsvOp {
  readonly op: 'exportCsv';
  readonly id?: string;
  /** Producer id of a series result. */
  readonly from: string;
  readonly file: string;
}
