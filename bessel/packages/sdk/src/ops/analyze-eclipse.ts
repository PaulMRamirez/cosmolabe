// The analyzeEclipse op: compute the occultation of the Sun by a body, as seen from the
// observer, over a grid-derived span, and publish the selected condition's intervals as
// an interval window. Delegates to @bessel/events eclipseIntervals. (STK_PARITY_SPEC, SDK.)

import { eclipseIntervals } from '@bessel/events';
import { resolveGrid } from '../job/grid.ts';
import { AnalysisInputError } from '../errors.ts';
import type { AnalyzeEclipseOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runAnalyzeEclipse(op: AnalyzeEclipseOp, ctx: OpContext): Promise<OpResult> {
  const et = await resolveGrid(ctx.engine, op.grid);
  if (et.length < 2) throw new AnalysisInputError('analyzeEclipse needs a grid with at least two epochs');
  const t0 = et[0]!;
  const t1 = et[et.length - 1]!;
  const step = stepOf(et);
  const bodyFrame = op.bodyFrame ?? `IAU_${op.body.toUpperCase()}`;
  const condition = op.condition ?? 'umbra';

  const intervals = await eclipseIntervals(ctx.engine, {
    observer: op.observer,
    body: op.body,
    bodyFrame,
    span: [t0, t1],
    step,
  });
  return {
    kind: 'intervals',
    window: intervals[condition],
    span: [t0, t1],
    label: `${op.observer} ${condition} (occulted by ${op.body})`,
  };
}

/** The grid-finder step: the smallest spacing in the grid, so brief events are caught. */
function stepOf(et: Float64Array): number {
  let min = Infinity;
  for (let i = 1; i < et.length; i++) min = Math.min(min, et[i]! - et[i - 1]!);
  return Number.isFinite(min) && min > 0 ? min : 60;
}
