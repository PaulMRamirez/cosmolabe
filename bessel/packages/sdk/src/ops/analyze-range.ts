// The range analysis op: sample observer-to-target range and range rate over a grid via
// the engine (spkezr). Emits a column series the CSV export consumes. (STK_PARITY_SPEC, SDK.)

import { resolveGrid } from '../job/grid.ts';
import type { AnalyzeOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runAnalyzeRange(op: AnalyzeOp, ctx: OpContext): Promise<OpResult> {
  const frame = op.frame ?? ctx.defaults.frame;
  const et = await resolveGrid(ctx.engine, op.grid);
  const range = new Float64Array(et.length);
  const rangeRate = new Float64Array(et.length);
  for (let i = 0; i < et.length; i++) {
    const s = await ctx.engine.spkezr(op.target, et[i]!, frame, 'NONE', op.observer);
    const r = s.position;
    const v = s.velocity;
    const rmag = Math.hypot(r.x, r.y, r.z);
    range[i] = rmag;
    rangeRate[i] = rmag === 0 ? 0 : (r.x * v.x + r.y * v.y + r.z * v.z) / rmag;
  }
  return { kind: 'series', et, columns: [range, rangeRate], names: ['range_km', 'rangeRate_kmps'] };
}
