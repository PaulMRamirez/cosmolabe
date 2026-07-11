// The coverage engine wired as a job (M-0004): one field product whose cells
// resolve across the globe as the sweep fills in, the signature motion of
// docs/design/03 section 6. The engine's per-cell hook feeds an async queue;
// the adapter snapshots the field once per completed row (NaN marks cells not
// yet resolved) so partial cadence is deterministic and bounded. Cancellation
// is cooperative at two levels: the sweep checks the signal between cells and
// the runner checks it between yields. Correction is explicit and required on
// the request, never defaulted (M-0002); the provenance frame is the grid's
// body-fixed frame, the domain the field lives on.

import { sweepCoverageGrid, type GridSpec } from '@bessel/coverage';
import type { Correction, Et } from '@cosmolabe/frames';
import type { EngineJob } from './job.ts';
import type { Product, ScalarField } from './product.ts';
import { AsyncQueue } from './queue.ts';

export interface CoverageJobRequest {
  readonly grid: GridSpec;
  /** Asset SPK ids/names; a cell counts as covered when any asset is in view. */
  readonly assets: readonly string[];
  readonly span: readonly [Et, Et];
  /** Geometry-finder step (s); shorter than the briefest pass. */
  readonly step: number;
  readonly minElevationRad: number;
  /** Explicit at every call site, never defaulted (M-0002). */
  readonly correction: Correction;
}

const COVERAGE_ENGINE_VERSION = '0.0.0'; // @bessel/coverage package version

export function coverageJob(req: CoverageJobRequest): EngineJob {
  const { grid } = req;
  const total = grid.latCount * grid.lonCount;
  const field = (values: Float64Array): ScalarField => ({
    name: 'percentCoverage',
    unit: 'percent',
    body: grid.body,
    frame: grid.bodyFrame,
    latMin: grid.latMin,
    latMax: grid.latMax,
    latCount: grid.latCount,
    lonMin: grid.lonMin,
    lonMax: grid.lonMax,
    lonCount: grid.lonCount,
    values,
  });
  const product = (values: Float64Array): Product => ({ kind: 'field', field: field(values) });

  return {
    engine: 'coverage',
    version: COVERAGE_ENGINE_VERSION,
    frame: grid.bodyFrame,
    correction: req.correction,
    units: { percentCoverage: 'percent' },
    async *run(ctx) {
      const values = new Float64Array(total).fill(Number.NaN);
      const rows = new AsyncQueue<{ done: number }>();
      const sweep = sweepCoverageGrid(ctx.engine, {
        grid,
        assets: req.assets,
        span: req.span,
        step: req.step,
        minElevationRad: req.minElevationRad,
        abcorr: req.correction,
        signal: ctx.signal,
        onCell: (cell, done) => {
          values[cell.rowIndex * grid.lonCount + cell.colIndex] = cell.fom.percentCoverage;
          if (done % grid.lonCount === 0 || done === total) rows.push({ done });
        },
      }).finally(() => rows.close());
      // Failures surface at the await below; this listener only prevents an
      // unhandled rejection while row partials are still streaming.
      void sweep.catch(() => {});

      for await (const { done } of rows) {
        yield { pct: (100 * done) / total, partial: product(values.slice()) };
      }
      await sweep;
      return product(values);
    },
  };
}
