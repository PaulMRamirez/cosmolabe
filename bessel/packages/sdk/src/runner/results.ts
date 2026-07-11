// The in-memory result of each operation, consumed by downstream export ops. A tagged
// union so a dispatch is exhaustive and an export op can reject a source it cannot
// serialize. (STK_PARITY_SPEC, SDK.)

import type { McsRun } from '@bessel/propagator';
import type { Window } from '@bessel/timeline';

export type OpResult =
  | {
      readonly kind: 'ephemeris';
      readonly objectName: string;
      readonly center: string;
      readonly frame: string;
      readonly et: Float64Array;
      /** n * 6 row-major [x,y,z,vx,vy,vz] per epoch. */
      readonly states: Float64Array;
    }
  | {
      readonly kind: 'series';
      readonly et: Float64Array;
      readonly columns: readonly Float64Array[];
      readonly names: readonly string[];
    }
  | {
      readonly kind: 'intervals';
      /** The interval window (an access/eclipse Gantt) in ET seconds. */
      readonly window: Window;
      /** The analysis span [t0, t1] in ET seconds the window was computed over. */
      readonly span: readonly [number, number];
      /** A human label for the window (used by report summaries). */
      readonly label: string;
    }
  | { readonly kind: 'mcs'; readonly run: McsRun; readonly center: string; readonly frame: string }
  | { readonly kind: 'void' };
