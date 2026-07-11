// Structural validation rejects malformed mission sequences up front with the specific
// typed error, so the executor never has to police shape. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { validateMcs } from './validate.ts';
import { McsError, MissingControlsOrGoalsError } from './errors.ts';
import type { Mcs, Segment } from './segments.ts';

const ini: Segment = {
  kind: 'InitialState',
  id: 'ini',
  epoch: 0,
  centralBody: 399,
  mass: 1000,
  frame: 'J2000',
  coord: { type: 'Cartesian', r: { x: 7000, y: 0, z: 0 }, v: { x: 0, y: 7.5, z: 0 } },
};

const wrap = (children: Segment[]): Mcs => ({ version: 1, root: { kind: 'Sequence', id: 'root', children } });

describe('validateMcs', () => {
  it('accepts a well-formed sequence', () => {
    expect(() => validateMcs(wrap([ini, { kind: 'Stop', id: 'end' }]))).not.toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => validateMcs(wrap([ini, { kind: 'Stop', id: 'ini' }]))).toThrow(McsError);
  });

  it('requires exactly one InitialState heading the root', () => {
    expect(() => validateMcs(wrap([{ kind: 'Stop', id: 'end' }]))).toThrow(McsError);
  });

  it('rejects a control pointing at the wrong segment kind', () => {
    const mcs = wrap([
      ini,
      {
        kind: 'Target',
        id: 'tgt',
        corrector: 'DifferentialCorrector',
        controls: [{ segment: 'coast', param: 'Maneuver.dv.x', perturbation: 1e-4 }],
        goals: [{ evalAt: 'End', type: 'Radius', desired: 8000, tolerance: 1e-3 }],
        children: [{ kind: 'Propagate', id: 'coast', model: 'TwoBody', maxDuration: 100, stop: [{ type: 'Duration', value: 100 }] }],
      },
    ]);
    expect(() => validateMcs(mcs)).toThrow(McsError);
  });

  it('rejects a Target with no controls', () => {
    const mcs = wrap([
      ini,
      {
        kind: 'Target',
        id: 'tgt',
        corrector: 'DifferentialCorrector',
        controls: [],
        goals: [{ evalAt: 'End', type: 'Radius', desired: 8000, tolerance: 1e-3 }],
        children: [{ kind: 'Stop', id: 's' }],
      },
    ]);
    expect(() => validateMcs(mcs)).toThrow(MissingControlsOrGoalsError);
  });

  it('rejects an over-determined Target without weights', () => {
    const mcs = wrap([
      ini,
      {
        kind: 'Target',
        id: 'tgt',
        corrector: 'DifferentialCorrector',
        controls: [{ segment: 'burn', param: 'Maneuver.dv.x', perturbation: 1e-4 }],
        goals: [
          { evalAt: 'End', type: 'Radius', desired: 8000, tolerance: 1e-3 },
          { evalAt: 'End', type: 'SMA', desired: 8000, tolerance: 1e-3 },
        ],
        children: [{ kind: 'Maneuver', id: 'burn', mode: 'Impulsive', attitude: 'VNB', dv: { x: 0, y: 0, z: 0 } }],
      },
    ]);
    expect(() => validateMcs(mcs)).toThrow(MissingControlsOrGoalsError);
  });
});
