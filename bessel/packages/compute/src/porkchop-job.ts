// The porkchop emitter (M-0008 P1, executed Session 10): the Lambert
// departure delta-v surface over a departure-epoch by time-of-flight grid,
// as a field-kind product on the grid domain of M-0004 amendment 1. The
// node math is @bessel/mission's solvePorkchopColumn, the same source the
// app's porkchop worker sweeps with, now behind the JobHandle protocol:
// states sample through the frames tier (one batch per axis column), each
// departure column streams a partial with NaN marking unsolved cells (both
// not-yet-swept and Lambert gaps; the gaps stay NaN in the final product,
// the heatmap's honest holes), and cancellation is cooperative between
// columns plus the runner's per-step macrotask yield. mu is explicit in
// the request: this job asserts no constants table.
//
// Cancellation posture at production grid sizes, stated: the cancel check
// runs once per departure column, so worst-case latency is one column,
// which costs one frames-tier state batch (tof.count epochs) plus
// tof.count Lambert solves; both are linear in the TOF axis and
// microseconds-per-node in practice, so a 100 by 100 production grid
// cancels within single-digit milliseconds of the request. The posture is
// pinned by a scale assertion in porkchop-job.test.ts (a 60 by 60 grid
// cancels after the first column, far short of completion) rather than by
// a wall-clock number that would vary per machine.

import { linspace, solvePorkchopColumn, type SampledState } from '@bessel/mission';
import type { Correction, Et } from '@cosmolabe/frames';
import type { EngineJob } from './job.ts';
import type { GridField, Product } from './product.ts';

const PORKCHOP_ENGINE_VERSION = '0.0.1';

export interface PorkchopJobRequest {
  readonly departureBody: string;
  readonly arrivalBody: string;
  /** The central body of the transfer (states sample about it). */
  readonly centerBody: string;
  readonly frame: string;
  readonly correction: Correction;
  /** Central-body GM (km^3/s^2), explicit at the call site. */
  readonly mu: number;
  /** Departure-epoch axis (ET s), inclusive bounds, count >= 2. */
  readonly departure: { readonly start: Et; readonly end: Et; readonly count: number };
  /** Time-of-flight axis (s), inclusive bounds, count >= 2. */
  readonly tof: { readonly start: number; readonly end: number; readonly count: number };
}

/** Build the porkchop engine job: field kind, grid domain (x = departure
 *  epoch, y = time of flight), one streamed partial per departure column. */
export function porkchopJob(req: PorkchopJobRequest): EngineJob {
  if (!(req.mu > 0)) throw new Error(`porkchopJob: mu must be positive, got ${req.mu}`);
  const departureEt = linspace(req.departure.start, req.departure.end, req.departure.count);
  const tofSec = linspace(req.tof.start, req.tof.end, req.tof.count);
  const nd = departureEt.length;
  const nt = tofSec.length;
  const label = `${req.departureBody} to ${req.arrivalBody} departure delta-v`;

  const field = (values: Float64Array): GridField => ({
    domain: 'grid',
    name: label,
    unit: 'km/s',
    x: {
      name: 'departure epoch',
      unit: 'ET s',
      min: req.departure.start,
      max: req.departure.end,
      count: nd,
    },
    y: { name: 'time of flight', unit: 's', min: req.tof.start, max: req.tof.end, count: nt },
    values,
  });

  return {
    engine: 'porkchop',
    version: PORKCHOP_ENGINE_VERSION,
    frame: req.frame,
    correction: req.correction,
    units: { [label]: 'km/s' },
    async *run(ctx) {
      // Row-major (y row by x column): values[j * nd + i] is TOF row j at
      // departure column i. NaN everywhere until a column resolves it.
      const values = new Float64Array(nd * nt).fill(Number.NaN);

      const depBatch = await ctx.frames.states({
        targets: [req.departureBody],
        observer: req.centerBody,
        frame: req.frame,
        correction: req.correction,
        epochs: departureEt,
      });
      const depState = (i: number): SampledState => ({
        position: {
          x: depBatch.states[i * 6]!,
          y: depBatch.states[i * 6 + 1]!,
          z: depBatch.states[i * 6 + 2]!,
        },
        velocity: {
          x: depBatch.states[i * 6 + 3]!,
          y: depBatch.states[i * 6 + 4]!,
          z: depBatch.states[i * 6 + 5]!,
        },
      });

      for (let i = 0; i < nd; i++) {
        ctx.throwIfCancelled();
        const arrivalEpochs = tofSec.map((tof) => departureEt[i]! + tof);
        const arrBatch = await ctx.frames.states({
          targets: [req.arrivalBody],
          observer: req.centerBody,
          frame: req.frame,
          correction: req.correction,
          epochs: arrivalEpochs,
        });
        const arrRow: SampledState[] = Array.from({ length: nt }, (_, j) => ({
          position: {
            x: arrBatch.states[j * 6]!,
            y: arrBatch.states[j * 6 + 1]!,
            z: arrBatch.states[j * 6 + 2]!,
          },
          velocity: {
            x: arrBatch.states[j * 6 + 3]!,
            y: arrBatch.states[j * 6 + 4]!,
            z: arrBatch.states[j * 6 + 5]!,
          },
        }));
        const column = solvePorkchopColumn(
          i,
          departureEt[i]!,
          depState(i),
          arrRow,
          tofSec,
          req.mu,
        );
        for (let j = 0; j < nt; j++) {
          const dv = column.nodes[j]!.deltaVKmS;
          values[j * nd + i] = dv === null ? Number.NaN : dv;
        }
        const pct = Math.round(((i + 1) / nd) * 100);
        const partial: Product = { kind: 'field', field: field(values.slice()) };
        yield { pct, partial };
      }

      return { kind: 'field', field: field(values) } satisfies Product;
    },
  };
}
