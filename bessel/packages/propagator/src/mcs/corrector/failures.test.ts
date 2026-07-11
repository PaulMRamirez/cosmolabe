// Fail-loud behavior of the corrector and executor: a singular Jacobian, a goal-bearing
// coast that only reaches its backstop, reserved features, and a non-converging target all
// throw the specific typed error with its payload, never a silent wrong answer.
// (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { runMcs } from '../executor.ts';
import { createMissionEnv } from '../env.ts';
import {
  DcNotConvergedError,
  McsError,
  SingularJacobianError,
  StopConditionNeverTriggeredError,
} from '../errors.ts';
import type { Mcs, Segment, TargetSegment } from '../segments.ts';

const MU = 398600.4418;
const env = createMissionEnv(new Map([[399, { gm: MU, bodyRadius: 6378.137 }]]), { rtol: 1e-12, atol: 1e-12 });
const vCirc = Math.sqrt(MU / 7000);

const ini: Segment = {
  kind: 'InitialState',
  id: 'ini',
  epoch: 0,
  centralBody: 399,
  mass: 1000,
  frame: 'J2000',
  coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: vCirc, z: 0 } },
};

const wrap = (tgt: TargetSegment): Mcs => ({ version: 1, root: { kind: 'Sequence', id: 'root', children: [ini, tgt] } });

describe('corrector failure modes', () => {
  it('throws SingularJacobianError for two collinear controls', () => {
    const tgt: TargetSegment = {
      kind: 'Target',
      id: 'tgt',
      corrector: 'DifferentialCorrector',
      // Two controls on the SAME burn axis => duplicate columns => rank-deficient.
      controls: [
        { segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-5 },
        { segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-5 },
      ],
      goals: [
        { evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4, weight: 1 },
        { evalAt: 'End', type: 'SMA', desired: 7100, tolerance: 1e-4, weight: 1 },
      ],
      children: [
        { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.02, y: 0, z: 0 } },
        { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 1500, stop: [{ type: 'Duration', value: 1500 }] },
      ],
    };
    expect(() => runMcs(wrap(tgt), env)).toThrow(SingularJacobianError);
  });

  it('throws StopConditionNeverTriggeredError when a goal coast hits only its backstop', () => {
    const tgt: TargetSegment = {
      kind: 'Target',
      id: 'tgt',
      corrector: 'DifferentialCorrector',
      controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-5 }],
      goals: [{ evalAt: 'coast', type: 'Radius', desired: 7100, tolerance: 1e-4 }],
      children: [
        { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.02, y: 0, z: 0 } },
        // Unreachable altitude => only the duration backstop fires.
        { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 600, stop: [{ type: 'Altitude', value: 1e6, crossing: 'rising' }] },
      ],
    };
    expect(() => runMcs(wrap(tgt), env)).toThrow(StopConditionNeverTriggeredError);
  });

  it('throws a loud McsError for an under-specified finite burn (no thrust/isp/duration)', () => {
    const tgt: TargetSegment = {
      kind: 'Target',
      id: 'tgt',
      corrector: 'DifferentialCorrector',
      controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-5 }],
      goals: [{ evalAt: 'End', type: 'Radius', desired: 7100, tolerance: 1e-4 }],
      children: [
        // A Finite burn missing its thrustN/isp/duration must fail loudly, not silently
        // coast or apply a zero burn.
        { kind: 'Maneuver', id: 'burn', mode: 'Finite', attitude: 'VNB', dv: { x: 0.02, y: 0, z: 0 } },
        { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 1500, stop: [{ type: 'Duration', value: 1500 }] },
      ],
    };
    expect(() => runMcs(wrap(tgt), env)).toThrow(McsError);
  });

  it('throws DcNotConvergedError (with payload) for an unreachable goal in few iterations', () => {
    const tgt: TargetSegment = {
      kind: 'Target',
      id: 'tgt',
      corrector: 'DifferentialCorrector',
      controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-6, maxStep: 1e-6, initial: 0 }],
      goals: [{ evalAt: 'End', type: 'Radius', desired: 50000, tolerance: 1e-6 }],
      settings: { maxIterations: 3 },
      children: [
        { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0, y: 0, z: 0 } },
        { kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 1500, stop: [{ type: 'Duration', value: 1500 }] },
      ],
    };
    try {
      runMcs(wrap(tgt), env);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DcNotConvergedError);
      const err = e as DcNotConvergedError;
      expect(err.iterations).toBe(3);
      expect(err.controls.length).toBe(1);
      expect(err.perGoal[0]!.satisfied).toBe(false);
      expect(err.perGoal[0]!.type).toBe('Radius');
    }
  });
});
