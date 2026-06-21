// Sample a Fixed trajectory: a constant position in the center frame, emitted at
// every grid epoch. No propagation; the body sits still relative to its center.

import type { Km3 } from '@bessel/scene';
import { TrajectoryError, fillTable, type PositionTable } from './shared.ts';

/** Emit `position` for every step. Fails loudly on a non-finite position. */
export function sampleFixed(position: Km3, etGrid: Float64Array): PositionTable {
  if (!position.every(Number.isFinite)) {
    throw new TrajectoryError('Fixed', `position must be finite, got [${position.join(', ')}]`);
  }
  return fillTable(etGrid, () => position);
}
