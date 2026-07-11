// [ux-p3-conjunction] The porkchop worker protocol is pure (no Worker, no DOM): the request
// validator and the run-slice reducer (start / progress / result / error / cancel) are tested
// directly, mirroring the screening-protocol tests.

import { describe, it, expect } from 'vitest';
import {
  INITIAL_PORKCHOP_RUN,
  reducePorkchopRun,
  validatePorkchopRequest,
  PorkchopRequestError,
  type PorkchopRequest,
  type PorkchopResultMessage,
} from './porkchop-protocol.ts';
import type { SampledState, PorkchopResult } from './engine/porkchop.ts';

const state: SampledState = { position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 } };

function request(overrides: Partial<PorkchopRequest> = {}): PorkchopRequest {
  return {
    grid: { departureEt: [0, 1], tofSec: [10, 20] },
    mu: 1.327e11,
    departureStates: [state, state],
    arrivalStates: [
      [state, state],
      [state, state],
    ],
    label: 'X -> Y',
    ...overrides,
  };
}

describe('validatePorkchopRequest', () => {
  it('accepts a well-formed 2x2 request', () => {
    expect(() => validatePorkchopRequest(request())).not.toThrow();
  });

  it('fails loud on a too-small grid, a non-positive mu, or mismatched state matrices', () => {
    expect(() => validatePorkchopRequest(request({ grid: { departureEt: [0], tofSec: [10, 20] } }))).toThrow(
      PorkchopRequestError,
    );
    expect(() => validatePorkchopRequest(request({ mu: 0 }))).toThrow(/mu must be a positive/);
    expect(() => validatePorkchopRequest(request({ departureStates: [state] }))).toThrow(/departureStates length/);
    expect(() => validatePorkchopRequest(request({ arrivalStates: [[state, state]] }))).toThrow(/arrivalStates rows/);
  });
});

describe('reducePorkchopRun', () => {
  it('start opens a running run with a zeroed bar and the total', () => {
    const s = reducePorkchopRun(INITIAL_PORKCHOP_RUN, { kind: 'start', total: 12 });
    expect(s).toEqual({ status: 'running', done: 0, total: 12 });
  });

  it('progress advances done/total; result marks done; error marks failed; cancel resets', () => {
    let s = reducePorkchopRun(INITIAL_PORKCHOP_RUN, { kind: 'start', total: 12 });
    s = reducePorkchopRun(s, { kind: 'progress', done: 5, total: 12 });
    expect(s).toMatchObject({ status: 'running', done: 5, total: 12 });

    const resultMsg: PorkchopResultMessage = { kind: 'result', result: {} as PorkchopResult };
    const done = reducePorkchopRun(s, resultMsg);
    expect(done.status).toBe('done');
    expect(done.done).toBe(12);

    const failed = reducePorkchopRun(s, { kind: 'error', message: 'no node solved' });
    expect(failed.status).toEqual({ error: 'no node solved' });

    expect(reducePorkchopRun(s, { kind: 'cancel' })).toEqual(INITIAL_PORKCHOP_RUN);
  });
});
