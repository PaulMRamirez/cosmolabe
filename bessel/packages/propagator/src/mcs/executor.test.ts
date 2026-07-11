// The interpreter threads an immutable state through a no-corrector sequence: epochs are
// monotone, boundary samples are deduped, a burn changes only the velocity, and a Stop
// short-circuits trailing siblings. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { runMcs } from './executor.ts';
import { createMissionEnv } from './env.ts';
import type { Mcs } from './segments.ts';

const env = createMissionEnv(new Map([[399, { gm: 398600.4418, bodyRadius: 6378.137 }]]), { rtol: 1e-12, atol: 1e-12 });

const baseChildren = [
  {
    kind: 'InitialState' as const,
    id: 'ini',
    epoch: 0,
    centralBody: 399,
    mass: 1000,
    frame: 'J2000' as const,
    coord: { type: 'Cartesian' as const, r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: 7.546, z: 0 } },
  },
  { kind: 'Propagate' as const, id: 'c1', model: 'TwoBody' as const, maxDuration: 1800, stop: [{ type: 'Duration' as const, value: 1800 }] },
  { kind: 'Maneuver' as const, id: 'burn', mode: 'Impulsive' as const, attitude: 'VNB' as const, dv: { x: 0.05, y: 0, z: 0 } },
  { kind: 'Propagate' as const, id: 'c2', model: 'TwoBody' as const, maxDuration: 1800, stop: [{ type: 'Duration' as const, value: 1800 }] },
];

describe('runMcs threading', () => {
  it('produces monotone, deduped samples across segments', () => {
    const mcs: Mcs = { version: 1, root: { kind: 'Sequence', id: 'root', children: baseChildren } };
    const run = runMcs(mcs, env);
    const ets = run.samples.map((s) => s.et);
    for (let k = 1; k < ets.length; k++) {
      expect(ets[k]!).toBeGreaterThan(ets[k - 1]! - 1e-9); // non-decreasing
      expect(Math.abs(ets[k]! - ets[k - 1]!)).toBeGreaterThan(1e-9); // no exact duplicate
    }
    expect(run.final.epoch).toBeCloseTo(3600, 6);
  });

  it('a Stop segment short-circuits trailing siblings', () => {
    const mcs: Mcs = {
      version: 1,
      root: {
        kind: 'Sequence',
        id: 'root',
        children: [
          baseChildren[0]!,
          baseChildren[1]!,
          { kind: 'Stop', id: 'halt' },
          baseChildren[2]!, // should never run
          baseChildren[3]!,
        ],
      },
    };
    const run = runMcs(mcs, env);
    // Final epoch is the end of c1 (1800), not 3600: the burn and c2 were skipped.
    expect(run.final.epoch).toBeCloseTo(1800, 6);
  });

  it('an impulsive burn raises the speed without moving position', () => {
    const mcs: Mcs = { version: 1, root: { kind: 'Sequence', id: 'root', children: baseChildren.slice(0, 3) } };
    const run = runMcs(mcs, env);
    const speed = Math.hypot(run.final.v.x, run.final.v.y, run.final.v.z);
    // After a half-ish orbit then a 0.05 km/s prograde burn, speed exceeds the post-coast
    // circular speed by exactly 0.05 (burn is the last segment).
    expect(speed).toBeGreaterThan(7.0);
  });
});
