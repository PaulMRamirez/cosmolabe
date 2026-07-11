// The Mission Control Sequence (MCS) design helper: assemble a small Astrogator-style
// sequence (initial state -> propagate -> impulsive maneuver -> Target/coast) from the
// panel's parameters, run it SPICE-free via @bessel/propagator runMission, and reduce
// the run into a store-ready result (final state, an altitude series along the arc, and
// the differential-corrector convergence report). All math is in @bessel/propagator;
// this module only builds the IR and shapes the result. Units: km, km/s, seconds.
// (STK_PARITY_SPEC §4.3.)

import {
  createMissionEnv,
  runMission,
  validateMcs,
  type BodyDynamics,
  type McsRun,
  type Mcs,
} from '@bessel/propagator';
import type { McsResult } from '../store/index.ts';

const EARTH_ID = 399;
const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;

/** The user-tunable parameters of the demonstration sequence. */
export interface McsDesign {
  /** Initial circular-orbit altitude (km above the Earth equator). */
  readonly altitudeKm: number;
  /** Coast duration before the maneuver (seconds). */
  readonly propDurationSec: number;
  /** Prograde (along-track) impulsive delta-v magnitude (km/s). */
  readonly dvKmS: number;
  /** Target final orbital radius the differential corrector drives to (km). */
  readonly targetRadiusKm: number;
}

export const DEFAULT_MCS_DESIGN: McsDesign = {
  altitudeKm: 500,
  propDurationSec: 1800,
  dvKmS: 0.05,
  targetRadiusKm: 7200,
};

/** Build the Mcs IR for the demonstration sequence from the design parameters. */
export function buildMcs(design: McsDesign): Mcs {
  const r0 = EARTH_RE + Math.max(100, design.altitudeKm);
  // Circular-orbit speed at the initial radius; the state starts on the +X axis moving +Y.
  const vCirc = Math.sqrt(EARTH_GM / r0);
  return {
    version: 1,
    root: {
      kind: 'Sequence',
      id: 'root',
      children: [
        {
          kind: 'InitialState',
          id: 'init',
          epoch: 0,
          centralBody: EARTH_ID,
          mass: 100,
          frame: 'J2000',
          coord: {
            type: 'Cartesian',
            r: { x: r0, y: 0, z: 0 },
            v: { x: 0, y: vCirc, z: 0 },
          },
        },
        {
          kind: 'Propagate',
          id: 'coast1',
          model: 'TwoBody',
          maxDuration: Math.max(60, design.propDurationSec),
          sampleStep: 60,
          stop: [{ type: 'Duration', value: Math.max(60, design.propDurationSec) }],
        },
        {
          // A Target segment whose differential corrector tunes the impulsive prograde
          // burn until the final orbital radius matches the desired value, then coasts a
          // half orbit. This exercises the DcReport convergence path the panel surfaces.
          kind: 'Target',
          id: 'target',
          corrector: 'DifferentialCorrector',
          controls: [
            { segment: 'burn', param: 'Maneuver.dv.x', initial: Math.max(0, design.dvKmS), perturbation: 1e-3 },
          ],
          goals: [
            { evalAt: 'coast2', type: 'Radius', desired: Math.max(r0, design.targetRadiusKm), tolerance: 1 },
          ],
          children: [
            {
              kind: 'Maneuver',
              id: 'burn',
              mode: 'Impulsive',
              attitude: 'VNB',
              dv: { x: Math.max(0, design.dvKmS), y: 0, z: 0 },
            },
            {
              kind: 'Propagate',
              id: 'coast2',
              model: 'TwoBody',
              maxDuration: 20000,
              sampleStep: 60,
              stop: [{ type: 'Apoapsis' }, { type: 'Duration', value: 20000 }],
            },
          ],
        },
      ],
    },
  };
}

/** The dynamics table the executor needs: just Earth's two-body parameters here. */
function earthEnv(): ReturnType<typeof createMissionEnv> {
  const dynamics: BodyDynamics = { gm: EARTH_GM, bodyRadius: EARTH_RE };
  return createMissionEnv(new Map([[EARTH_ID, dynamics]]));
}

/** The reduced result plus the sampled arc points (km, Earth-centered) for the scene. */
export interface McsRunOutput {
  readonly result: McsResult;
  readonly arc: readonly (readonly [number, number, number])[];
}

/** Run the demonstration MCS and reduce it into a store-ready result plus arc points. */
export async function runMcsDesign(design: McsDesign): Promise<McsRunOutput> {
  const mcs = buildMcs(design);
  validateMcs(mcs);
  const run = await runMission(mcs, earthEnv());
  const altLabel = `MCS altitude (km), target ${design.targetRadiusKm} km`;
  const label = `MCS: ${design.altitudeKm} km LEO, ${design.dvKmS} km/s burn`;
  return { result: reduceRun(run, altLabel, label), arc: mcsArcPoints(run) };
}

/**
 * Run an editable, user-built MCS (compiled from the segment editor's EditableMcs to the
 * Mcs IR) and reduce it the same way as the demonstration run, so the panel renders the
 * residual convergence trace and solved delta-v from the corrector. SPICE-free.
 */
export async function runEditableMcs(mcs: Mcs): Promise<McsRunOutput> {
  validateMcs(mcs);
  const run = await runMission(mcs, earthEnv());
  return { result: reduceRun(run, 'MCS altitude (km)', 'Editable MCS'), arc: mcsArcPoints(run) };
}

/** Reduce an McsRun into the result the panel renders (final state + altitude + DC report).
 *  Surfaces the per-iteration residual convergence trace and the solved prograde delta-v. */
function reduceRun(run: McsRun, altLabel: string, label: string): McsResult {
  const { final, samples, targetReports } = run;
  const finalRadiusKm = Math.hypot(final.r.x, final.r.y, final.r.z);
  const finalSpeedKmS = Math.hypot(final.v.x, final.v.y, final.v.z);
  const et = new Float64Array(samples.length);
  const altitude = new Float64Array(samples.length);
  samples.forEach((s, i) => {
    et[i] = s.et;
    const p = s.state.position;
    altitude[i] = Math.hypot(p.x, p.y, p.z) - EARTH_RE;
  });
  const dc = targetReports.length > 0 ? targetReports[targetReports.length - 1]! : null;
  const goals = dc
    ? dc.perGoal.map((g) => ({
        type: String(g.type),
        achieved: g.achieved,
        desired: g.desired,
        residual: g.residual,
        satisfied: g.satisfied,
      }))
    : [];
  // The corrector's first control is the prograde dv (Maneuver.dv.x), so its solved value is
  // the magnitude the differential corrector found; null when no Target ran.
  const solvedDvKmS = dc && dc.controls.length > 0 ? Math.abs(dc.controls[0]!) : null;
  return {
    finalRadiusKm,
    finalSpeedKmS,
    finalEpoch: final.epoch,
    altitude: { et, value: altitude, label: altLabel },
    converged: dc ? dc.converged : null,
    iterations: dc ? dc.iterations : 0,
    goals,
    residualHistory: dc ? dc.history.map((h) => ({ iter: h.iter, normF: h.normF })) : [],
    solvedDvKmS,
    label,
  };
}

/** The sampled arc positions (km, Earth-centered J2000) for scene rendering. */
export function mcsArcPoints(run: McsRun): readonly (readonly [number, number, number])[] {
  return run.samples.map((s) => [s.state.position.x, s.state.position.y, s.state.position.z] as const);
}
