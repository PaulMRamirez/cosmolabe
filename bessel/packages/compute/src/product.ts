// AnalysisProduct v0: the one output shape every engine emits across panel,
// app, SDK, and CLI (ADR M-0004; docs/design/02 section 5; the four-form
// grammar of docs/design/03 and M-0008). Product, Provenance, and
// AnalysisProduct are transcribed exactly as typed in the design; the four
// payload shapes are the v0 concretions of the four kinds, each carrying the
// canonical data its one visual form consumes. Units are SPICE kilometers,
// kilometers per second, radians, and ET seconds at this contract (iron rule
// 9); the UnitMap names them per column and layer so the render boundary
// converts knowingly, never implicitly. Any output that does not fit the four
// kinds triggers a schema conversation, not a fifth kind by default (M-0004).

import type { Correction, Et, FrameId, IsoString } from '@cosmolabe/frames';

/** One labeled set of [start, stop] ET intervals: a timeline lane. */
export interface IntervalSet {
  readonly label: string;
  readonly intervals: readonly (readonly [Et, Et])[];
}

/** One named scalar quantity over a shared time axis: a strip chart. */
export interface TimeSeries {
  readonly name: string;
  readonly unit: string;
  readonly et: Float64Array;
  readonly values: Float64Array;
}

/** One in-scene drape layer (footprint, swath, ground track, LOS line). */
export interface GeoLayer {
  readonly label: string;
  /** The frame the positions are expressed in. */
  readonly frame: FrameId;
  readonly form: 'polyline' | 'points';
  /** Interleaved x, y, z positions (km), length 3n. */
  readonly positions: Float64Array;
}

/** A scalar field over a uniform lat/lon domain: a heatmap drape. */
export interface ScalarField {
  readonly name: string;
  readonly unit: string;
  /** The central body and its body-fixed frame the domain lies on. */
  readonly body: string;
  readonly frame: FrameId;
  /** Inclusive domain bounds (rad) and cell counts; row-major values. */
  readonly latMin: number;
  readonly latMax: number;
  readonly latCount: number;
  readonly lonMin: number;
  readonly lonMax: number;
  readonly lonCount: number;
  /**
   * Row-major cell values (lat row by lon column), length latCount * lonCount.
   * NaN marks a cell not yet resolved; streamed field partials fill in as the
   * sweep advances (the signature motion of docs/design/03 section 6).
   */
  readonly values: Float64Array;
}

export type Product =
  | { kind: 'intervals'; sets: IntervalSet[] }
  | { kind: 'series'; series: TimeSeries[] }
  | { kind: 'geometry'; layers: GeoLayer[] }
  | { kind: 'field'; field: ScalarField };

/** Column or layer name to unit string, for the render boundary's conversions. */
export type UnitMap = Readonly<Record<string, string>>;

/**
 * The provenance block that makes the authority question machine-readable
 * (M-0004). kernels.setHash comes from the frames tier's KernelSetInfo, the
 * same source the differential harness commits in its delta tables, so a
 * product's provenance row is reproducible against them. authority 'host' is
 * settable only by host data adapters; every engine emits 'exploratory', and
 * the job runner enforces it (iron rule 4). No host data adapter exists yet;
 * the host door lands with the first one, by ADR, not here.
 */
export interface Provenance {
  readonly engine: string;
  readonly version: string;
  readonly kernels: { readonly setHash: string; readonly names: readonly string[] };
  readonly frame: FrameId;
  readonly correction: Correction;
  readonly authority: 'host' | 'exploratory';
  readonly computedAt: IsoString;
  readonly jobId: string;
}

export interface AnalysisProduct {
  readonly product: Product;
  readonly provenance: Provenance;
  readonly units: UnitMap;
}
