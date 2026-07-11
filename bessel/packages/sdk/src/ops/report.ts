// The report op: reduce a set of prior producer results to a canonical (sorted-key)
// JSON summary file. Each producer is summarized by its kind into stable headline
// metrics (interval windows get an @bessel/coverage figure of merit), so the report is
// byte-identical across runs. Reads no kernels and queries no geometry. (STK_PARITY_SPEC, SDK.)

import { figureOfMerit } from '@bessel/coverage';
import { ReportError } from '../errors.ts';
import { canonicalJson } from '../runner/manifest.ts';
import type { ReportOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runReport(op: ReportOp, ctx: OpContext): Promise<OpResult> {
  const producers: Record<string, unknown> = {};
  for (const id of op.from) {
    const src = ctx.registry.get(id);
    if (!src) throw new ReportError(`report references producer "${id}" that was not produced by any prior op`, `from`);
    producers[id] = summarize(src);
  }
  const summary = { besselBatch: '1', producers };
  await ctx.io.writeFile(op.file, new TextEncoder().encode(canonicalJson(summary)));
  return { kind: 'void' };
}

const round = (v: number): number => (Number.isFinite(v) ? Number(v.toPrecision(9)) : v);

/** Reduce one producer result to a stable, sorted-key-friendly summary object. */
function summarize(result: OpResult): unknown {
  switch (result.kind) {
    case 'ephemeris':
      return {
        kind: 'ephemeris',
        objectName: result.objectName,
        center: result.center,
        frame: result.frame,
        sampleCount: result.et.length,
        firstEt: round(result.et[0] ?? NaN),
        lastEt: round(result.et[result.et.length - 1] ?? NaN),
      };
    case 'series':
      return {
        kind: 'series',
        sampleCount: result.et.length,
        columns: result.names.map((name, i) => ({
          name,
          first: round(result.columns[i]?.[0] ?? NaN),
          last: round(result.columns[i]?.[result.et.length - 1] ?? NaN),
        })),
      };
    case 'intervals': {
      const fom = figureOfMerit(result.window, result.span);
      return {
        kind: 'intervals',
        label: result.label,
        intervalCount: result.window.length,
        percentCoverage: round(fom.percentCoverage),
        maxGapSec: round(fom.maxGapSec),
        timeToFirstSec: fom.timeToFirstSec === null ? null : round(fom.timeToFirstSec),
      };
    }
    case 'mcs':
      return {
        kind: 'mcs',
        center: result.center,
        frame: result.frame,
        sampleCount: result.run.samples.length,
      };
    case 'void':
      return { kind: 'void' };
  }
}
