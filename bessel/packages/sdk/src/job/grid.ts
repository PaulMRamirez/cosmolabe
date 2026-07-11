// Resolve a GridSpec to ET epochs via the engine (an LSK must be furnished first). Used
// by propagate and analyze ops to build their sample grid. (STK_PARITY_SPEC, SDK.)

import type { SpiceEngine } from '@bessel/spice';
import { AnalysisInputError } from '../errors.ts';
import type { GridSpec } from './types.ts';

export async function resolveGrid(engine: SpiceEngine, grid: GridSpec): Promise<Float64Array> {
  if ('epochs' in grid) {
    const ets = new Float64Array(grid.epochs.length);
    for (let i = 0; i < grid.epochs.length; i++) ets[i] = await engine.str2et(stripZ(grid.epochs[i]!));
    for (let i = 1; i < ets.length; i++) {
      if (ets[i]! <= ets[i - 1]!) throw new AnalysisInputError('grid epochs must be strictly increasing');
    }
    return ets;
  }
  const et0 = await engine.str2et(stripZ(grid.start));
  const et1 = await engine.str2et(stripZ(grid.stop));
  if (et1 <= et0) throw new AnalysisInputError(`grid stop (${grid.stop}) must be after start (${grid.start})`);
  const n = Math.floor((et1 - et0) / grid.stepSec) + 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = et0 + i * grid.stepSec;
  return out;
}

/** SPICE str2et rejects a trailing Z; strip it (the times are UTC by contract). */
const stripZ = (s: string): string => s.replace(/Z$/, '');
