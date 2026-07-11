// @bessel/compute: the compute plane of ADR M-0004. One job protocol
// (JobHandle: streaming partials, result, cancel), one product schema
// (AnalysisProduct v0: intervals, series, geometry, field, each with exactly
// one canonical visual form per M-0008), one provenance block whose kernel
// set hash comes from the frames tier, and the first two engines wired end
// to end as jobs. Engines emit authority 'exploratory' only (iron rule 4);
// the host door lands with the first host data adapter, by ADR.

export type {
  AnalysisProduct,
  GeoLayer,
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
  type JobHandle,
  type JobProgress,
  type JobRunContext,
} from './job.ts';
export { accessJob, type AccessJobRequest } from './access-job.ts';
export { coverageJob, type CoverageJobRequest } from './coverage-job.ts';
export { AsyncQueue } from './queue.ts';
