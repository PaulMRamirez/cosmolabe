// Shared types and helpers for the catalog trajectory samplers. A PositionTable is
// the flat per-step [x,y,z] layout the polyline and generic-mission already consume
// (the same byBody Float64Array shape as sampler.ts), so a sampled non-SPICE
// trajectory drops into the existing trajectoryOf/positionAt pipeline unchanged.

import type { Km3 } from '@bessel/scene';
import type { Trajectory } from '@bessel/catalog';

/** A sampled trajectory over an ET grid: epochs plus a flat [x,y,z] per step. */
export interface PositionTable {
  /** ET seconds for each step (length = steps). */
  readonly times: Float64Array;
  /** Flat [x,y,z] per step, length steps*3 (km, J2000, relative to the center). */
  readonly flat: Float64Array;
  readonly steps: number;
}

/**
 * Located, typed error for a trajectory that cannot be sampled (a bad-catalog
 * reference per the fail-loudly convention). Carries the trajectory type and the
 * underlying cause.
 */
export class TrajectoryError extends Error {
  constructor(
    readonly trajectoryType: Trajectory['type'],
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`${trajectoryType} trajectory: ${message}`);
    this.name = 'TrajectoryError';
  }
}

/** Build a PositionTable by evaluating `at(k)` (a J2000 position, km) per grid step. */
export function fillTable(etGrid: Float64Array, at: (k: number) => Km3): PositionTable {
  const steps = etGrid.length;
  const flat = new Float64Array(steps * 3);
  for (let k = 0; k < steps; k++) {
    const p = at(k);
    flat[k * 3] = p[0];
    flat[k * 3 + 1] = p[1];
    flat[k * 3 + 2] = p[2];
  }
  return { times: Float64Array.from(etGrid), flat, steps };
}

/** The polyline points (km, relative to the center) from a PositionTable. */
export function tablePoints(table: PositionTable): Km3[] {
  const points: Km3[] = [];
  for (let k = 0; k < table.steps; k++) {
    points.push([table.flat[k * 3]!, table.flat[k * 3 + 1]!, table.flat[k * 3 + 2]!]);
  }
  return points;
}
