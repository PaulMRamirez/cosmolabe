// The MCS IR is pure data: a full tree covering every segment kind must survive a
// JSON round-trip unchanged (the serializability contract that lets a mission be saved,
// shared, and replayed). (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import type { Mcs } from './segments.ts';

const FULL: Mcs = {
  version: 1,
  root: {
    kind: 'Sequence',
    id: 'root',
    children: [
      {
        kind: 'InitialState',
        id: 'ini',
        epoch: 0,
        centralBody: 399,
        mass: 1000,
        frame: 'J2000',
        coord: { type: 'Keplerian', el: { sma: 7000, ecc: 0.01, inc: 0.9, raan: 0.1, argp: 0.2, trueAnomaly: 0 } },
      },
      {
        kind: 'Target',
        id: 'tgt',
        corrector: 'DifferentialCorrector',
        controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-4 }],
        goals: [{ evalAt: 'End', type: 'RadiusOfApoapsis', desired: 8000, tolerance: 1e-3 }],
        children: [
          { kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0.1, y: 0, z: 0 } },
          {
            kind: 'Propagate',
            id: 'coast',
            model: 'TwoBody',
            maxDuration: 6000,
            stop: [{ type: 'Apoapsis' }, { type: 'Altitude', value: 500, crossing: 'rising' }],
          },
        ],
      },
      { kind: 'Stop', id: 'end' },
    ],
  },
};

describe('MCS IR serializability', () => {
  it('round-trips through JSON unchanged (identity)', () => {
    const clone = JSON.parse(JSON.stringify(FULL)) as Mcs;
    expect(clone).toEqual(FULL);
  });

  it('carries a Cartesian initial state without loss', () => {
    const mcs: Mcs = {
      version: 1,
      root: {
        kind: 'Sequence',
        id: 'r',
        children: [
          {
            kind: 'InitialState',
            id: 'i',
            epoch: 1000,
            centralBody: 399,
            mass: 500,
            frame: 'J2000',
            coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: 7.5, z: 0 } },
          },
        ],
      },
    };
    expect(JSON.parse(JSON.stringify(mcs))).toEqual(mcs);
  });
});
