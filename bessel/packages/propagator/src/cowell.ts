// The Cowell propagator entry point: numerically integrate a Cartesian state under a
// force model and return the same EphemerisTable shape the analytic propagators
// produce, so the arc flows into publishEphemeris -> writeSpkType13 -> spkpos with no
// special path. Pure and synchronous: the force model's terms are already resolved,
// so this needs no SPICE. (STK_PARITY_SPEC §4.2.)

import type { CartesianState } from '@bessel/spice';
import { emptyTable, type EphemerisTable } from './elements.ts';
import { integrate, type IntegratorOptions, type Rhs } from './integrator.ts';
import { integrateDense, type Solution } from './dense.ts';
import type { EventHit, EventSpec } from './events.ts';
import { augmentInitialState, makeStmRhs, stmFromState, STM_DIM } from './stm.ts';
import { IntegrationError } from './errors.ts';
import type { ForceModel } from './force/types.ts';

export interface CowellOptions {
  /** Initial Cartesian state (km, km/s) in `frame`, central-body-centered. */
  readonly state: CartesianState;
  /** ET of the initial state. */
  readonly epoch: number;
  /** Output epochs (ascending, all >= epoch). */
  readonly etGrid: Float64Array;
  /** The (synchronous) force model summing every perturbation. */
  readonly forceModel: ForceModel;
  /** Inertial frame label stored on the table (default 'J2000'). */
  readonly frame?: string;
  readonly tolerances?: IntegratorOptions;
  /** Switching functions to detect; a terminal one truncates the arc (propagateCowellEx). */
  readonly events?: readonly EventSpec[];
  /** Co-integrate the 6x6 STM via the variational equations (propagateCowellEx). */
  readonly stm?: boolean;
  /** When `stm`, central-difference any term lacking analytic partials (default true). */
  readonly fdFallback?: boolean;
}

/** The extended Cowell result: the sampled table plus the continuous/STM/event channels. */
export interface CowellResult {
  /** Column ephemeris sampled at the grid epochs within the integrated domain. */
  readonly table: EphemerisTable;
  /** The continuous (dense) solution over [epoch, tEnd]. */
  readonly solution: Solution;
  /** Located event hits in ascending epoch order (empty if no events requested). */
  readonly events: readonly EventHit[];
  /** True iff a terminal event truncated the arc before the last grid epoch. */
  readonly stopped: boolean;
  /** The epoch the arc actually reached. */
  readonly tEnd: number;
  /** The 6x6 STM Phi(et, epoch) row-major (length 36), or undefined if `stm` was off. */
  stmAt?(et: number): Float64Array;
}

/**
 * Cowell special-perturbations propagation: integrate the state over `etGrid` under
 * `forceModel`, returning a column EphemerisTable. The force model's acceleration is
 * evaluated as dy/dt = [v, a(t, r, v)].
 */
export function propagateCowell(opts: CowellOptions): EphemerisTable {
  const { state, epoch, etGrid, forceModel } = opts;
  const frame = opts.frame ?? 'J2000';

  const y0 = Float64Array.of(
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
  );

  const rhs: Rhs = (t, y, dy) => {
    const a = forceModel.acceleration({
      et: t,
      r: [y[0]!, y[1]!, y[2]!],
      v: [y[3]!, y[4]!, y[5]!],
    });
    dy[0] = y[3]!;
    dy[1] = y[4]!;
    dy[2] = y[5]!;
    dy[3] = a[0];
    dy[4] = a[1];
    dy[5] = a[2];
  };

  const states = integrate(rhs, y0, epoch, etGrid, opts.tolerances);

  const n = etGrid.length;
  const table = emptyTable(frame, etGrid);
  for (let k = 0; k < n; k++) {
    const s = states[k]!;
    (table.x as Float64Array)[k] = s[0]!;
    (table.y as Float64Array)[k] = s[1]!;
    (table.z as Float64Array)[k] = s[2]!;
    (table.vx as Float64Array)[k] = s[3]!;
    (table.vy as Float64Array)[k] = s[4]!;
    (table.vz as Float64Array)[k] = s[5]!;
  }
  return table;
}

/**
 * Extended Cowell propagation: the same integration plus a continuous (dense) solution,
 * optional event detection (a terminal event truncates the arc), and an optional
 * co-integrated STM. The returned `table` samples only the grid epochs that fall inside
 * the integrated domain (so a terminal stop yields a shorter table). Use this when you
 * need off-grid interpolation, stop conditions, or sensitivities; `propagateCowell`
 * stays the lean grid-only path. (STK_PARITY_SPEC §4.2.)
 */
export function propagateCowellEx(opts: CowellOptions): CowellResult {
  const { state, epoch, etGrid, forceModel } = opts;
  const frame = opts.frame ?? 'J2000';
  const wantStm = opts.stm ?? false;
  const dim = wantStm ? STM_DIM : 6;

  const tf = etGrid[etGrid.length - 1]!;
  if (tf <= epoch) throw new IntegrationError(`propagateCowellEx needs the grid to extend past the epoch (got tf=${tf} <= epoch=${epoch})`);

  const base = Float64Array.of(
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
  );
  const y0 = wantStm ? augmentInitialState(base) : base;

  const rhs: Rhs = wantStm
    ? makeStmRhs(forceModel, opts.fdFallback ?? true)
    : (t, y, dy) => {
        const a = forceModel.acceleration({ et: t, r: [y[0]!, y[1]!, y[2]!], v: [y[3]!, y[4]!, y[5]!] });
        dy[0] = y[3]!;
        dy[1] = y[4]!;
        dy[2] = y[5]!;
        dy[3] = a[0];
        dy[4] = a[1];
        dy[5] = a[2];
      };

  const { solution, events, stopped, tEnd } = integrateDense(rhs, y0, epoch, tf, {
    ...opts.tolerances,
    events: opts.events,
  });

  // Sample only the grid epochs that lie within the integrated domain (a terminal stop
  // shortens it). Clamp to tEnd, not solution.tf: on a terminal event the arc must not emit
  // states past the event epoch (a sample in (tEnd, solution.tf] would be physically stale,
  // e.g. below the surface after impact). The dense Solution domain is itself capped at tEnd.
  const usable = Array.from(etGrid).filter((t) => t >= epoch - 1e-9 && t <= tEnd + 1e-9);
  const grid = Float64Array.from(usable);
  const table = emptyTable(frame, grid);
  const buf = new Float64Array(dim);
  for (let k = 0; k < grid.length; k++) {
    solution.interpolateInto(grid[k]!, buf);
    (table.x as Float64Array)[k] = buf[0]!;
    (table.y as Float64Array)[k] = buf[1]!;
    (table.z as Float64Array)[k] = buf[2]!;
    (table.vx as Float64Array)[k] = buf[3]!;
    (table.vy as Float64Array)[k] = buf[4]!;
    (table.vz as Float64Array)[k] = buf[5]!;
  }

  const result: CowellResult = { table, solution, events, stopped, tEnd };
  if (wantStm) {
    const scratch = new Float64Array(dim);
    result.stmAt = (et: number): Float64Array => {
      solution.interpolateInto(et, scratch);
      return stmFromState(scratch);
    };
  }
  return result;
}
