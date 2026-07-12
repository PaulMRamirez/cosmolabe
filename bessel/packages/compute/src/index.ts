// @bessel/compute: the compute plane of ADR M-0004. One job protocol
// (JobHandle: streaming partials, result, cancel), one product schema
// (AnalysisProduct v0: intervals, series, geometry, field, each with exactly
// one canonical visual form per M-0008), one provenance block whose kernel
// set hash comes from the frames tier, and the first two engines wired end
// to end as jobs. Engines emit authority 'exploratory' only (iron rule 4);
// the host door lands with the first host data adapter, by ADR.
//
// Stability policy: this surface is schema v0 and additive only until the
// packages restructure. New optional fields, new exported helpers, and new
// engine adapters may land; renaming, removing, retyping, or changing the
// semantics of anything exported here is a breaking change and requires an
// M-0004 amendment first, not a refactor. The policy is mechanical, not
// aspirational: api-surface.test.ts holds a committed snapshot of the public
// shapes and the export list, and any drift fails typecheck or the test
// suite, so a breaking change cannot land quietly.

export type {
  AnalysisProduct,
  Field,
  FieldAxis,
  GeoLayer,
  GridField,
  IntervalSet,
  Product,
  Provenance,
  ScalarField,
  TimeSeries,
  UnitMap,
} from './product.ts';
export {
  createComputeEnv,
  submitJob,
  JobCancelledError,
  type ComputeEnv,
  type EngineJob,
  type SpkPublication,
  type JobHandle,
  type JobProgress,
  type JobRunContext,
} from './job.ts';
export { accessJob, type AccessJobRequest } from './access-job.ts';
export { coverageJob, type CoverageJobRequest } from './coverage-job.ts';
export { seriesJob, type SeriesJobRequest, type SeriesProviderSpec } from './series-job.ts';
export { groundTrackJob, type GroundTrackJobRequest } from './ground-track-job.ts';
export { porkchopJob, type PorkchopJobRequest } from './porkchop-job.ts';
export {
  encodeAnalysisProduct,
  decodeAnalysisProduct,
  encodeF64,
  decodeF64,
  type EncodedF64,
  type SerializedAnalysisProduct,
  type SerializedField,
  type SerializedGeoLayer,
  type SerializedGridField,
  type SerializedProduct,
  type SerializedScalarField,
  type SerializedTimeSeries,
} from './serialization.ts';
export {
  JobClient,
  JobClientCancelled,
  type JobProgressEvent,
  type JobRun,
  type SubstrateWorker,
} from './substrate-client.ts';
export type {
  JobSpec,
  SubstrateInit,
  SubstrateRequest,
  SubstrateResponse,
  WireSpkPublication,
} from './substrate-protocol.ts';
export { AsyncQueue } from './queue.ts';
