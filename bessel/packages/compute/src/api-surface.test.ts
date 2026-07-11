// The API-surface snapshot demanded by the stability policy (schema v0,
// additive only until the packages restructure; breaking changes require an
// M-0004 amendment first). The mirrors below are the committed snapshot of
// the public shapes: the Exact assertions fail `pnpm typecheck` if any
// exported schema type drifts in either direction, the keyof pins fail it if
// a protocol member is renamed or removed, and the runtime test fails if the
// export list changes. Additive evolution updates this snapshot in the same
// commit, deliberately; anything else is a breaking change.

import { describe, it, expect } from 'vitest';
import * as api from './index.ts';

type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

// ── schema snapshot (full mirrors, self-contained primitives) ───────────────

interface SnapIntervalSet {
  readonly label: string;
  readonly intervals: readonly (readonly [number, number])[];
}
interface SnapTimeSeries {
  readonly name: string;
  readonly unit: string;
  readonly et: Float64Array;
  readonly values: Float64Array;
}
interface SnapGeoLayer {
  readonly label: string;
  readonly frame: string;
  readonly form: 'polyline' | 'points';
  readonly positions: Float64Array;
}
interface SnapScalarField {
  readonly name: string;
  readonly unit: string;
  readonly body: string;
  readonly frame: string;
  readonly latMin: number;
  readonly latMax: number;
  readonly latCount: number;
  readonly lonMin: number;
  readonly lonMax: number;
  readonly lonCount: number;
  readonly values: Float64Array;
}
type SnapProduct =
  | { kind: 'intervals'; sets: SnapIntervalSet[] }
  | { kind: 'series'; series: SnapTimeSeries[] }
  | { kind: 'geometry'; layers: SnapGeoLayer[] }
  | { kind: 'field'; field: SnapScalarField };
interface SnapProvenance {
  readonly engine: string;
  readonly version: string;
  readonly kernels: { readonly setHash: string; readonly names: readonly string[] };
  readonly frame: string;
  readonly correction: 'NONE' | 'LT' | 'LT+S' | 'CN' | 'CN+S';
  readonly authority: 'host' | 'exploratory';
  readonly computedAt: string;
  readonly jobId: string;
}
interface SnapAnalysisProduct {
  readonly product: SnapProduct;
  readonly provenance: SnapProvenance;
  readonly units: Readonly<Record<string, string>>;
}
interface SnapJobProgress {
  readonly pct: number;
  readonly partial?: SnapAnalysisProduct;
}
interface SnapJobHandle {
  progress: AsyncIterable<SnapJobProgress>;
  result: Promise<SnapAnalysisProduct>;
  cancel(): void;
}
interface SnapEncodedF64 {
  readonly encoding: 'f64le-base64';
  readonly data: string;
}

type _ProductExact = Assert<Exact<api.Product, SnapProduct>>;
type _ProvenanceExact = Assert<Exact<api.Provenance, SnapProvenance>>;
type _AnalysisProductExact = Assert<Exact<api.AnalysisProduct, SnapAnalysisProduct>>;
type _IntervalSetExact = Assert<Exact<api.IntervalSet, SnapIntervalSet>>;
type _TimeSeriesExact = Assert<Exact<api.TimeSeries, SnapTimeSeries>>;
type _GeoLayerExact = Assert<Exact<api.GeoLayer, SnapGeoLayer>>;
type _ScalarFieldExact = Assert<Exact<api.ScalarField, SnapScalarField>>;
type _UnitMapExact = Assert<Exact<api.UnitMap, Readonly<Record<string, string>>>>;
type _JobProgressExact = Assert<Exact<api.JobProgress, SnapJobProgress>>;
type _JobHandleExact = Assert<Exact<api.JobHandle, SnapJobHandle>>;
type _EncodedF64Exact = Assert<Exact<api.EncodedF64, SnapEncodedF64>>;

// ── protocol member pins (rename or removal fails typecheck) ────────────────

type _EngineJobKeys = Assert<
  Exact<keyof api.EngineJob, 'engine' | 'version' | 'frame' | 'correction' | 'units' | 'run'>
>;
type _JobRunContextKeys = Assert<
  Exact<keyof api.JobRunContext, 'engine' | 'frames' | 'signal' | 'throwIfCancelled'>
>;
type _ComputeEnvKeys = Assert<Exact<keyof api.ComputeEnv, 'engine' | 'frames' | 'furnish'>>;
type _AccessJobRequestKeys = Assert<
  Exact<
    keyof api.AccessJobRequest,
    'observer' | 'targets' | 'span' | 'step' | 'constraints' | 'correction'
  >
>;
type _CoverageJobRequestKeys = Assert<
  Exact<
    keyof api.CoverageJobRequest,
    'grid' | 'assets' | 'span' | 'step' | 'minElevationRad' | 'correction'
  >
>;
type _SerializedProductKinds = Assert<
  Exact<api.SerializedProduct['kind'], 'intervals' | 'series' | 'geometry' | 'field'>
>;

describe('compute plane API surface (stability policy)', () => {
  it('exports exactly the committed runtime surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AsyncQueue',
      'JobCancelledError',
      'accessJob',
      'coverageJob',
      'createComputeEnv',
      'decodeAnalysisProduct',
      'decodeF64',
      'encodeAnalysisProduct',
      'encodeF64',
      'submitJob',
    ]);
  });
});
