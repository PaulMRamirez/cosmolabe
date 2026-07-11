// Trajectory resolver: turn any catalog Trajectory into a flat position table over an
// ET grid, relative to the center body, so non-SPICE trajectories (Keplerian, TLE,
// Fixed, Sampled) render as a polyline through the same pipeline as SPICE arcs. The
// 'Spice' branch reuses sampleEphemeris (one geometry source of truth); the rest call
// the dedicated samplers, which reuse the @bessel/propagator engines and the PAL.
//
// SIZE: this module is reached only via a dynamic import from generic-mission.ts, and
// each non-SPICE sampler dynamically imports @bessel/propagator, so the heavy SGP4 /
// mean-element code stays in the lazy analysis bundle, never the first-paint shell.

import type { SpiceEngine } from '@bessel/spice';
import type { FileSystem } from '@bessel/pal';
import type { Trajectory } from '@bessel/catalog';
import { sampleEphemeris } from '../sampler.ts';
import { STEPS } from '../engine/constants.ts';
import { TrajectoryError, type PositionTable } from './shared.ts';
import { sampleTle } from './tle.ts';
import { sampleKeplerian } from './keplerian.ts';
import { sampleFixed } from './fixed.ts';
import { sampleSampled } from './sampled.ts';

export { TrajectoryError, tablePoints, type PositionTable } from './shared.ts';

/** The id the SGP4/Keplerian/SPICE math centers on, defaulting to Earth/Sun by type. */
function centerId(trajectory: Trajectory, fallback: string): string {
  return trajectory.center ?? fallback;
}

/**
 * Sample `trajectory` over `etGrid` into a position table (km, J2000, relative to the
 * resolved center). `bodyName`/`bodyId` identify the object for the SPICE path; `fs` is
 * the PAL FileSystem the Sampled reader uses. Fails loudly (a located TrajectoryError)
 * on missing data, an unsupported source, or invalid elements.
 */
export async function sampleTrajectory(
  spice: SpiceEngine,
  fs: FileSystem | undefined,
  trajectory: Trajectory,
  etGrid: Float64Array,
  bodyName: string,
  bodyId: string,
): Promise<PositionTable> {
  switch (trajectory.type) {
    case 'Spice': {
      // Reuse the existing SPICE sampler so a SPICE arc and a propagated arc share one
      // code path. Sample relative to the declared center (default Earth) by id.
      const center = trajectory.target ?? bodyId;
      const observer = centerId(trajectory, '399');
      const table = await sampleEphemeris(
        spice,
        [{ name: bodyName, spiceId: center }],
        etGrid[0]!,
        etGrid[etGrid.length - 1]!,
        etGrid.length,
        observer,
      );
      const flat = table.byBody.get(bodyName)!;
      return { times: Float64Array.from(table.times), flat, steps: table.steps };
    }
    case 'Tle':
      return sampleTle(spice, trajectory.line1, trajectory.line2, etGrid, centerId(trajectory, '399'));
    case 'Keplerian':
      return sampleKeplerian(spice, trajectory.elements, etGrid, centerId(trajectory, '10'), trajectory.mu);
    case 'Fixed':
      return sampleFixed([...trajectory.position], etGrid);
    case 'Sampled': {
      if (!fs) {
        throw new TrajectoryError('Sampled', 'no PAL FileSystem available to read the source file');
      }
      return sampleSampled(spice, fs, trajectory.source, trajectory.format, etGrid);
    }
  }
}

/** Build an even ET grid of STEPS samples over [et0, et1] (the default sampling grid). */
export function trajectoryGrid(et0: number, et1: number, steps = STEPS): Float64Array {
  const grid = new Float64Array(steps);
  for (let k = 0; k < steps; k++) grid[k] = et0 + ((et1 - et0) * k) / (steps - 1);
  return grid;
}
