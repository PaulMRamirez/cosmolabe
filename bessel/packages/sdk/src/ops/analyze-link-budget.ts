// The analyzeLinkBudget op: sample the observer-to-target range over a grid (spkpos via
// the engine), then roll up the @bessel/rf link budget per epoch into a column series
// (range, pathLoss, ebN0, margin). The CSV export consumes the series. (STK_PARITY_SPEC, SDK.)

import { linkBudget } from '@bessel/rf';
import { resolveGrid } from '../job/grid.ts';
import type { AnalyzeLinkBudgetOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runAnalyzeLinkBudget(op: AnalyzeLinkBudgetOp, ctx: OpContext): Promise<OpResult> {
  const frame = op.frame ?? ctx.defaults.frame;
  const et = await resolveGrid(ctx.engine, op.grid);
  const range = new Float64Array(et.length);
  const pathLoss = new Float64Array(et.length);
  const ebN0 = new Float64Array(et.length);
  const margin = new Float64Array(et.length);

  for (let i = 0; i < et.length; i++) {
    const p = await ctx.engine.spkpos(op.target, et[i]!, frame, 'NONE', op.observer);
    const distanceKm = Math.hypot(p.position.x, p.position.y, p.position.z);
    const budget = linkBudget({
      eirpDbW: op.radio.eirpDbW,
      distanceKm,
      freqHz: op.radio.freqHz,
      gOverTDbK: op.radio.gOverTDbK,
      dataRateBps: op.radio.dataRateBps,
      otherLossesDb: op.radio.otherLossesDb,
      requiredEbN0Db: op.radio.requiredEbN0Db,
    });
    range[i] = distanceKm;
    pathLoss[i] = budget.pathLossDb;
    ebN0[i] = budget.ebN0Db;
    margin[i] = budget.marginDb ?? NaN;
  }

  return {
    kind: 'series',
    et,
    columns: [range, pathLoss, ebN0, margin],
    names: ['range_km', 'pathLoss_dB', 'ebN0_dB', 'margin_dB'],
  };
}
