// @bessel/sdk: a programmatic automation facade plus a JSON batch-job IR and a headless
// runner over the Bessel compute core (load kernels, propagate, run an MCS, analyze, and
// export OEM/CSV). Depends only on core packages and the PAL interface; a shell injects a
// concrete Node PAL. (STK_PARITY_SPEC, SDK.)

export { defineJob, type JobBuilder } from './builder/job-builder.ts';
export {
  runJob,
  type RunRequest,
  type RunResult,
  type RunSummary,
  type OpRecord,
  type RunIo,
  type RunManifest,
  type KernelDigest,
  type OutputDigest,
} from './runner/run.ts';
export { validateJob } from './job/validate.ts';
export { BODY_GM } from './runner/bodies.ts';
export { canonicalJson } from './runner/manifest.ts';
export type { OpResult } from './runner/results.ts';
export type {
  BatchJob,
  JobDefaults,
  OutputDecl,
  GridSpec,
  EntityDecl,
  SatelliteSource,
  Operation,
  FurnishOp,
  PropagateOp,
  RunMcsOp,
  AnalyzeOp,
  AnalyzeEclipseOp,
  AnalyzeAccessOp,
  AnalyzeLinkBudgetOp,
  LoadCatalogOp,
  ReportOp,
  ExportOemOp,
  ExportCsvOp,
} from './job/types.ts';
export {
  SdkError,
  JobSchemaError,
  UnsupportedJobVersionError,
  JobReferenceError,
  KernelResolveError,
  AnalysisInputError,
  ExportError,
  McsValidationError,
  CatalogLoadError,
  ReportError,
} from './errors.ts';
