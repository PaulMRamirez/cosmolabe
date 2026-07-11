// The exportCsv op: serialize a series result (a column time series) or an intervals
// result (an access/eclipse Gantt) to CSV with UTC epoch labels, through the existing
// interop writers (seriesToCsv / intervalsToCsv). (STK_PARITY_SPEC, SDK.)

import { intervalsToCsv, seriesToCsv } from '@bessel/interop';
import { ExportError } from '../errors.ts';
import type { ExportCsvOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runExportCsv(op: ExportCsvOp, ctx: OpContext): Promise<OpResult> {
  const src = ctx.registry.get(op.from);
  if (!src) throw new ExportError(`exportCsv source "${op.from}" was not produced by any prior op`, `from`);

  if (src.kind === 'series') {
    const labels: string[] = [];
    for (let i = 0; i < src.et.length; i++) labels.push(await ctx.engine.et2utc(src.et[i]!, 'ISOC', 6));
    const csv = seriesToCsv(src.et, src.columns, src.names, { epochHeader: 'utc', epochLabels: labels });
    await ctx.io.writeFile(op.file, new TextEncoder().encode(csv));
    return { kind: 'void' };
  }

  if (src.kind === 'intervals') {
    // Pre-format each interval endpoint to a UTC label (et2utc is async; intervalsToCsv
    // takes a synchronous formatter), keyed by ET so the format closure stays pure.
    const labels = new Map<number, string>();
    for (const [start, stop] of src.window) {
      if (!labels.has(start)) labels.set(start, await ctx.engine.et2utc(start, 'ISOC', 6));
      if (!labels.has(stop)) labels.set(stop, await ctx.engine.et2utc(stop, 'ISOC', 6));
    }
    const csv = intervalsToCsv(src.window, {
      startHeader: 'start_utc',
      stopHeader: 'stop_utc',
      format: (et) => labels.get(et) ?? String(et),
    });
    await ctx.io.writeFile(op.file, new TextEncoder().encode(csv));
    return { kind: 'void' };
  }

  throw new ExportError(`exportCsv cannot serialize a "${src.kind}" result`, `from`);
}
