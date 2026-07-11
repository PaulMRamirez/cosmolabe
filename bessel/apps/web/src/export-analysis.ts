// The unified "export this analysis" service (design section 7, decision 4): one entry
// the analysis cards route their CSV/OEM exports through instead of the fragmented
// per-card paths. It serializes a discriminated union of result kinds via the existing
// @bessel/interop builders, triggers a download through the PAL-backed downloadBlob,
// and returns the serialized text so the routing is unit-testable. Fails loudly with a
// typed, located error on an unknown kind (the fail-loudly convention).
//
// Phase 0.1 provides the service and its tests only; migrating the existing per-card
// CSV/OEM calls onto it is Phase 0.2 / Phase 1.

import { seriesToCsv, intervalsToCsv, tableToCsv, writeOem, type CsvMeta, type Oem } from '@bessel/interop';
import { downloadBlob } from '@bessel/ui';

/** Export a column time series (epoch + named columns) as CSV. */
export interface SeriesExportSpec {
  readonly kind: 'series';
  readonly et: ArrayLike<number>;
  readonly columns: readonly ArrayLike<number>[];
  readonly names: readonly string[];
  readonly filename: string;
  readonly meta?: CsvMeta;
}

/** Export interval windows (start, stop, duration) as CSV. */
export interface IntervalsExportSpec {
  readonly kind: 'intervals';
  readonly intervals: readonly (readonly [number, number])[];
  readonly filename: string;
  readonly meta?: CsvMeta;
}

/** Export an arbitrary header + rows table (scalar readouts) as CSV. */
export interface TableExportSpec {
  readonly kind: 'table';
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
  readonly filename: string;
  readonly meta?: CsvMeta;
}

/** Export a trajectory as a CCSDS OEM (KVN) document. */
export interface OemExportSpec {
  readonly kind: 'oem';
  readonly oem: Oem;
  readonly filename: string;
}

/** Export a conjunction event as a CCSDS-CDM-style (KVN) record. The text is serialized by the
 *  co-located conjunction CDM writer (the @bessel/interop package ships a parser, not a writer),
 *  so this spec carries the already-built KVN text and the exporter only routes the download. */
export interface CdmExportSpec {
  readonly kind: 'cdm';
  readonly text: string;
  readonly filename: string;
}

/** The discriminated union of analysis results the unified exporter can serialize. */
export type ExportSpec =
  | SeriesExportSpec
  | IntervalsExportSpec
  | TableExportSpec
  | OemExportSpec
  | CdmExportSpec;

/** A located, typed error for an export the service cannot serialize (fail-loudly). */
export class ExportAnalysisError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(`exportAnalysis(${kind}): ${message}`);
    this.name = 'ExportAnalysisError';
  }
}

/** MIME type per export kind: CSV for the tabular kinds, plain text for the OEM/CDM KVN. */
function mimeFor(spec: ExportSpec): string {
  return spec.kind === 'oem' || spec.kind === 'cdm' ? 'text/plain' : 'text/csv';
}

/** Serialize an export spec to its file text via the matching @bessel/interop builder. */
function serialize(spec: ExportSpec): string {
  switch (spec.kind) {
    case 'series':
      return seriesToCsv(spec.et, spec.columns, spec.names, spec.meta ? { meta: spec.meta } : {});
    case 'intervals':
      return intervalsToCsv(spec.intervals, spec.meta ? { meta: spec.meta } : {});
    case 'table':
      return tableToCsv(spec.headers, spec.rows, spec.meta ? { meta: spec.meta } : {});
    case 'oem':
      return writeOem(spec.oem);
    case 'cdm':
      // The CDM KVN is already serialized by the conjunction CDM writer; route the text as-is.
      return spec.text;
    default: {
      // Exhaustiveness guard: a new kind that is not handled fails loudly, not silently.
      const unknown: never = spec;
      const kind = (unknown as { kind?: unknown }).kind;
      throw new ExportAnalysisError(String(kind ?? 'unknown'), 'unsupported export kind');
    }
  }
}

/**
 * Serialize an analysis result and trigger its download, returning the serialized text.
 * `download` is injectable so tests can assert routing without a DOM (defaults to the
 * PAL-backed downloadBlob). Returning the text keeps the service pure-testable.
 */
export function exportAnalysis(
  spec: ExportSpec,
  download: (blob: Blob, filename: string) => void = downloadBlob,
): string {
  const text = serialize(spec);
  download(new Blob([text], { type: mimeFor(spec) }), spec.filename);
  return text;
}
