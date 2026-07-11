// The propagate op: sample an object's trajectory onto a grid. 'sgp4' runs a TLE and
// converts the TEME output to J2000 (via the frames transform); 'twobody' integrates a
// Cartesian state under point-mass gravity. Optionally publishes the arc to an SPK so
// later ops can query it through the engine. (STK_PARITY_SPEC, SDK.)

import {
  createForceModel,
  emptyTable,
  parseTle,
  pointMass,
  propagateCowell,
  publishEphemeris,
  sgp4,
  sgp4init,
  temeToJ2000AtEt,
  type EphemerisTable,
} from '@bessel/propagator';
import { AnalysisInputError } from '../errors.ts';
import { BODY_GM } from '../runner/bodies.ts';
import { resolveGrid } from '../job/grid.ts';
import type { PropagateOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

const stripZ = (s: string): string => s.replace(/Z$/, '');

export async function runPropagate(op: PropagateOp, ctx: OpContext): Promise<OpResult> {
  const entity = ctx.entities.get(op.object);
  if (!entity || entity.type !== 'satellite') {
    throw new AnalysisInputError(`propagate object "${op.object}" is not a declared satellite entity`);
  }
  const frame = op.frame ?? ctx.defaults.frame;
  const center = op.center ?? ctx.defaults.center;
  const grid = await resolveGrid(ctx.engine, op.grid);
  const states = new Float64Array(grid.length * 6);

  const src = entity.source;
  if (op.method === 'sgp4') {
    if (src.kind !== 'tle') throw new AnalysisInputError(`sgp4 propagation needs a 'tle' source for "${op.object}"`);
    const tle = parseTle(src.line1, src.line2);
    const rec = sgp4init(tle);
    const epoch = await ctx.engine.str2et(stripZ(tle.epochUtc));
    for (let i = 0; i < grid.length; i++) {
      const teme = sgp4(rec, (grid[i]! - epoch) / 60);
      const { position, velocity } = temeToJ2000AtEt(teme, grid[i]!);
      writeRow(states, i, position, velocity);
    }
  } else {
    if (src.kind !== 'state') throw new AnalysisInputError(`twobody propagation needs a 'state' source for "${op.object}"`);
    const epoch = await ctx.engine.str2et(stripZ(src.epoch));
    const dyn = BODY_GM.get(src.centralBody);
    if (!dyn) throw new AnalysisInputError(`no gravitational parameter registered for central body ${src.centralBody}`);
    if (grid[0]! < epoch - 1e-6) throw new AnalysisInputError('twobody grid must start at or after the state epoch');
    const table = propagateCowell({
      state: { position: { x: src.r[0], y: src.r[1], z: src.r[2] }, velocity: { x: src.v[0], y: src.v[1], z: src.v[2] } },
      epoch,
      etGrid: grid,
      forceModel: createForceModel([pointMass(dyn.gm)]),
      frame,
    });
    for (let i = 0; i < grid.length; i++) {
      writeRow(states, i, [table.x[i]!, table.y[i]!, table.z[i]!], [table.vx[i]!, table.vy[i]!, table.vz[i]!]);
    }
  }

  if (op.publishAs) {
    const table = tableFromStates(frame, grid, states);
    await publishEphemeris(ctx.engine, table, {
      name: `${op.id}.bsp`,
      body: op.publishAs.naifId,
      center: namedCenterId(center),
      degree: op.publishAs.degree ?? 7,
    });
  }

  return { kind: 'ephemeris', objectName: op.object, center, frame, et: grid, states };
}

function writeRow(states: Float64Array, i: number, r: readonly number[], v: readonly number[]): void {
  states[i * 6] = r[0]!;
  states[i * 6 + 1] = r[1]!;
  states[i * 6 + 2] = r[2]!;
  states[i * 6 + 3] = v[0]!;
  states[i * 6 + 4] = v[1]!;
  states[i * 6 + 5] = v[2]!;
}

function tableFromStates(frame: string, et: Float64Array, states: Float64Array): EphemerisTable {
  const table = emptyTable(frame, et);
  for (let i = 0; i < et.length; i++) {
    (table.x as Float64Array)[i] = states[i * 6]!;
    (table.y as Float64Array)[i] = states[i * 6 + 1]!;
    (table.z as Float64Array)[i] = states[i * 6 + 2]!;
    (table.vx as Float64Array)[i] = states[i * 6 + 3]!;
    (table.vy as Float64Array)[i] = states[i * 6 + 4]!;
    (table.vz as Float64Array)[i] = states[i * 6 + 5]!;
  }
  return table;
}

/** Map a small set of center names to NAIF ids for publishing (Earth default). */
function namedCenterId(center: string): number {
  const c = center.toUpperCase();
  if (c === 'EARTH' || c === '399') return 399;
  if (c === 'SUN' || c === '10') return 10;
  if (c === 'MOON' || c === '301') return 301;
  if (c === 'MARS' || c === '499' || c === '4') return 499;
  const n = Number(center);
  if (Number.isFinite(n)) return n;
  throw new AnalysisInputError(`cannot map center "${center}" to a NAIF id for publishing`);
}
