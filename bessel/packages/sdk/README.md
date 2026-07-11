# @bessel/sdk

The headless automation layer: a programmatic facade plus a serializable JSON batch-job IR and a deterministic runner that composes the Bessel compute core (load kernels and catalogs, propagate, run a Mission Control Sequence, analyze geometry and communications, summarize, export OEM/CSV) with no UI and no browser. Core layer.

## Operations

The `operations` array drives the run in order. The full op set:

- `furnish` resolve named kernels through the PAL `KernelSource` and load them.
- `loadCatalog` read a Cosmographia catalog as text (through the `RunIo.readText` seam) and furnish every kernel it references.
- `propagate` sample a satellite trajectory onto a grid (`sgp4` or `twobody`), optionally publishing the arc as an SPK for later ops.
- `runMcs` execute a `@bessel/propagator` Mission Control Sequence.
- `analyze` (`kind: 'range'`) observer-to-target range and range rate over a grid, a column series.
- `analyzeEclipse` umbra/penumbra/annular/sunlit intervals (`@bessel/events`) over a grid, an interval window.
- `analyzeAccess` line-of-sight access (`@bessel/access`) with an optional ground-facility elevation mask and range gate, an interval window.
- `analyzeLinkBudget` range series plus the `@bessel/rf` link budget, a series with columns (range, pathLoss, ebN0, margin).
- `report` reduce a set of prior producer results to a canonical (sorted-key) JSON summary file.
- `exportOem` serialize an ephemeris or MCS result to a CCSDS OEM file.
- `exportCsv` serialize a series result, or an interval window (`@bessel/interop intervalsToCsv`), to CSV with UTC epochs.

## Public API

Authoring:

- `defineJob(meta?): JobBuilder` a chainable builder (`furnish`, `loadCatalog`, `satellite`, `propagate`, `runMcs`, `analyze`, `analyzeEclipse`, `analyzeAccess`, `analyzeLinkBudget`, `report`, `exportOem`, `exportCsv`, `output`) that lowers to the same `BatchJob` IR a hand-written JSON file parses into. `toJSON()` validates before returning.
- `validateJob(input): BatchJob` the hand-written structural validator (the runtime source of truth); every failure is a `JobSchemaError` carrying a JSON pointer to the offending node (or `UnsupportedJobVersionError`). A shipped `src/job/schema.json` (JSON Schema Draft 2020-12) describes the same job for editor autocomplete and external tooling, kept in lockstep by a consistency test.
- The `BatchJob` IR types: `Operation` (a discriminated union of `FurnishOp`, `LoadCatalogOp`, `PropagateOp`, `RunMcsOp`, `AnalyzeOp`, `AnalyzeEclipseOp`, `AnalyzeAccessOp`, `AnalyzeLinkBudgetOp`, `ReportOp`, `ExportOemOp`, `ExportCsvOp`), `EntityDecl`, `SatelliteSource`, `GridSpec`, `JobDefaults`, `OutputDecl`.

Running:

- `runJob(req: RunRequest): Promise<RunResult>` opens a SPICE engine, validates the job, resolves references, and executes operations in order against an injected `RunIo` (the PAL seam: a `KernelSource`, a `writeFile`, and an optional `readText`). Returns a per-op record, a provenance `manifest` (kernel digests, op statuses, output file hashes), and a CI-grade exit code (0 ok, 1 stopped on failure, 3 completed with failures).
- `RunIo`, `RunRequest`, `RunResult`, `OpRecord`, `OpResult`, `RunManifest`, `KernelDigest`, `OutputDigest`, `canonicalJson`, `BODY_GM`.

```ts
import { defineJob, runJob } from '@bessel/sdk';

const job = defineJob()
  .satellite('SAT', { kind: 'state', epoch: '2025-03-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.546, 0] })
  .furnish(['naif0012.tls'])
  .propagate('eph', { object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T01:00:00', stepSec: 600 } })
  .exportOem({ from: 'eph', file: 'eph.oem' })
  .output({ dir: 'out' })
  .toJSON();

const result = await runJob({ job, io }); // io: a Node PAL from @bessel/pal-node, or an in-memory test PAL
```

## Dependency rule

Depends on: `@bessel/pal` (interface only), `@bessel/spice`, `@bessel/timeline`, `@bessel/propagator`, `@bessel/interop`, `@bessel/events`, `@bessel/access`, `@bessel/rf`, `@bessel/coverage`, `@bessel/catalog`. Core layer: it injects no concrete PAL; a shell (`apps/cli`) supplies the Node IO via `@bessel/pal-node`. Operations delegate to the existing compute packages (`propagateCowell`, the MCS executor, SGP4 with `temeToJ2000`, `eclipseIntervals`, `computeAccess`/`computeElevationAccess`, `linkBudget`, `figureOfMerit`, `parseCosmographiaCatalog`, `writeOem`/`seriesToCsv`/`intervalsToCsv`).

## Determinism and errors

Artifacts are byte-stable (the OEM and CSV writers, the canonical JSON report, and the et2utc epoch formatting are deterministic), so the same job produces identical output across runs; `runJob` returns a provenance manifest digesting each kernel and output (sha256 via Web Crypto) and `canonicalJson` serializes with sorted keys. Every failure is a typed, located `SdkError` (`JobSchemaError`, `JobReferenceError`, `KernelResolveError`, `AnalysisInputError`, `ExportError`, `McsValidationError`, `CatalogLoadError`, `ReportError`); a malformed job or a dangling producer reference throws before anything executes.

## Tests

`packages/sdk/src/job/validate.test.ts` (pointer-exact rejection of malformed jobs), `job/schema.test.ts` (the shipped JSON Schema and the hand validator agree), `builder/job-builder.test.ts` (the builder lowers to the expected IR), `runner/manifest.test.ts` (digest and canonical-JSON primitives), and the end-to-end runner specs `runner/e2e-propagate.test.ts`, `e2e-mcs.test.ts`, `e2e-analyze.test.ts`, `e2e-eclipse.test.ts`, `e2e-access.test.ts`, `e2e-link-budget.test.ts`, `e2e-load-catalog.test.ts`, `e2e-report.test.ts` (each runs a full job with the real SPICE engine and an in-memory PAL, asserts a value oracle against an independent computation, and asserts byte-identical output across two runs), plus `runner/exit-codes.test.ts` (the exit-code contract).
