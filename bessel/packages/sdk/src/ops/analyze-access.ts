// The analyzeAccess op: compute the visibility (access) window of an observer to a
// target over a grid-derived span. A line-of-sight constraint, an optional ground
// facility elevation mask, and an optional range gate are intersected into one interval
// window. Delegates to @bessel/access (computeAccess / computeElevationAccess) and the
// @bessel/timeline window algebra. (STK_PARITY_SPEC, SDK.)

import { computeAccess, computeElevationAccess, type AccessConstraint, type Facility } from '@bessel/access';
import { windowIntersectAll, type Window } from '@bessel/timeline';
import { resolveGrid } from '../job/grid.ts';
import { AnalysisInputError } from '../errors.ts';
import type { AnalyzeAccessOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

const DEG = Math.PI / 180;

export async function runAnalyzeAccess(op: AnalyzeAccessOp, ctx: OpContext): Promise<OpResult> {
  const et = await resolveGrid(ctx.engine, op.grid);
  if (et.length < 2) throw new AnalysisInputError('analyzeAccess needs a grid with at least two epochs');
  const t0 = et[0]!;
  const t1 = et[et.length - 1]!;
  const span: [number, number] = [t0, t1];
  const step = stepOf(et);

  const losBody = op.losBody ?? ctx.defaults.center;
  const losBodyFrame = op.losBodyFrame ?? `IAU_${losBody.toUpperCase()}`;

  const constraints: AccessConstraint[] = [{ kind: 'lineOfSight', body: losBody, bodyFrame: losBodyFrame }];
  if (op.maxRangeKm !== undefined || op.minRangeKm !== undefined) {
    constraints.push({ kind: 'range', maxKm: op.maxRangeKm, minKm: op.minRangeKm });
  }

  const windows: Window[] = [
    await computeAccess(ctx.engine, { observer: op.observer, target: op.target, span, step, constraints }),
  ];

  if (op.facility) {
    const facility: Facility = {
      body: op.facility.body,
      bodyFrame: op.facility.bodyFrame,
      lonRad: op.facility.lonDeg * DEG,
      latRad: op.facility.latDeg * DEG,
      altKm: op.facility.altKm,
    };
    windows.push(await computeElevationAccess(ctx.engine, facility, op.target, span, step, op.facility.minElevationDeg * DEG));
  }

  return {
    kind: 'intervals',
    window: windowIntersectAll(windows),
    span,
    label: `${op.observer} to ${op.target} access`,
  };
}

/** The grid-finder step: the smallest spacing in the grid, so brief events are caught. */
function stepOf(et: Float64Array): number {
  let min = Infinity;
  for (let i = 1; i < et.length; i++) min = Math.min(min, et[i]! - et[i - 1]!);
  return Number.isFinite(min) && min > 0 ? min : 60;
}
