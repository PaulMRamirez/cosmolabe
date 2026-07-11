// The series emitter (M-0004, kind 'series'): the eval-series machinery
// wired as a job, streaming the strip-chart payload chunk by chunk so charts
// materialize as the sweep advances. Providers come from the unit-tagged
// eval-series catalog; the request's correction is injected into every
// provider (explicit, never defaulted, M-0002) and the request's frame is the
// frame of record: a provider that carries its own frame must agree with it,
// loudly, so the provenance row never understates a mixed-frame product.

import {
  describeProvider,
  gridEpochs,
  runEvalSpec,
  type ProviderKind,
  type ProviderSpec,
} from 'cspice-wasm';
import type { Correction, Et, FrameId, Seconds } from '@cosmolabe/frames';
import type { EngineJob } from './job.ts';
import type { Product, TimeSeries, UnitMap } from './product.ts';

/** A provider spec without abcorr: the job's correction is the only source. */
export type SeriesProviderSpec = {
  [K in ProviderKind]: Omit<Extract<ProviderSpec, { kind: K }>, 'abcorr'>;
}[ProviderKind];

export interface SeriesJobRequest {
  readonly providers: readonly SeriesProviderSpec[];
  readonly span: readonly [Et, Et];
  readonly step: Seconds;
  /** The frame of record for the product's provenance. */
  readonly frame: FrameId;
  /** Explicit at every call site, never defaulted (M-0002). */
  readonly correction: Correction;
  /** Partial cadence: the sweep is split into this many chunks (default 8). */
  readonly chunks?: number;
}

const SERIES_ENGINE_VERSION = '0.0.0'; // cspice-wasm eval-series interpreter

const seriesName = (p: SeriesProviderSpec, column: string): string =>
  `${column} (${p.observer} to ${p.target})`;

export function seriesJob(req: SeriesJobRequest): EngineJob {
  if (req.providers.length === 0) throw new Error('seriesJob: at least one provider is required');
  for (const p of req.providers) {
    const frame = 'frame' in p ? p.frame : undefined;
    if (frame !== undefined && frame !== req.frame) {
      throw new Error(
        `seriesJob: provider ${p.kind} names frame '${frame}' but the request's frame of ` +
          `record is '${req.frame}'; a mixed-frame series would understate its provenance`,
      );
    }
  }

  const units: Record<string, string> = {};
  for (const p of req.providers) {
    const d = describeProvider(p.kind);
    for (const column of d.columns) units[seriesName(p, column)] = d.unit;
  }

  return {
    engine: 'series',
    version: SERIES_ENGINE_VERSION,
    frame: req.frame,
    correction: req.correction,
    units: units as UnitMap,
    async *run(ctx) {
      const et = gridEpochs({ start: req.span[0], stop: req.span[1], step: req.step });
      const chunkCount = Math.max(1, Math.min(req.chunks ?? 8, et.length));
      const providers = req.providers.map((p) => ({ ...p, abcorr: req.correction }));

      // One accumulator per output column, filled chunk by chunk.
      const names: string[] = [];
      for (const p of req.providers) {
        for (const column of describeProvider(p.kind).columns) names.push(seriesName(p, column));
      }
      const acc = names.map(() => new Float64Array(et.length).fill(Number.NaN));

      const partial = (filled: number): Product => ({
        kind: 'series',
        series: names.map(
          (name, i): TimeSeries => ({
            name,
            unit: units[name]!,
            et: et.slice(0, filled),
            values: acc[i]!.slice(0, filled),
          }),
        ),
      });

      let filled = 0;
      for (let c = 0; c < chunkCount; c++) {
        ctx.throwIfCancelled();
        const from = Math.floor((c * et.length) / chunkCount);
        const to = Math.floor(((c + 1) * et.length) / chunkCount);
        if (to <= from) continue;
        const result = await runEvalSpec(
          ctx.engine,
          { grid: { et: et.slice(from, to) }, providers },
          { isCancelled: () => ctx.signal.aborted },
        );
        for (let i = 0; i < result.columns.length; i++) acc[i]!.set(result.columns[i]!, from);
        filled = to;
        yield { pct: (100 * filled) / et.length, partial: partial(filled) };
      }
      return partial(et.length);
    },
  };
}
