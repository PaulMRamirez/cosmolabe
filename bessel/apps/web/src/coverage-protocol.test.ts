import { describe, it, expect } from 'vitest';
import {
  reduceCoverageSweep,
  validateCoverageRequest,
  CoverageRequestError,
  INITIAL_COVERAGE_SWEEP,
  type CoverageRequest,
} from './coverage-protocol.ts';
import type { GridSpec } from '@bessel/coverage';
import type { KernelOp } from './spice-recorder.ts';

const grid: GridSpec = {
  body: 'EARTH',
  bodyFrame: 'IAU_EARTH',
  latMin: -1,
  latMax: 1,
  latCount: 3,
  lonMin: -3,
  lonMax: 3,
  lonCount: 4,
};

const kernels: KernelOp[] = [{ kind: 'furnsh', name: 'de440.bsp', bytes: new Uint8Array([1, 2]) }];

const okRequest: CoverageRequest = {
  kernels,
  grid,
  assets: ['-999'],
  span: [0, 86400],
  step: 300,
  minElevationRad: 0.1,
};

describe('validateCoverageRequest', () => {
  it('accepts a well-formed request', () => {
    expect(() => validateCoverageRequest(okRequest)).not.toThrow();
  });

  it('throws a located error on an empty kernel log', () => {
    expect(() => validateCoverageRequest({ ...okRequest, kernels: [] })).toThrow(CoverageRequestError);
  });

  it('throws on no assets', () => {
    expect(() => validateCoverageRequest({ ...okRequest, assets: [] })).toThrow(/at least one asset/);
  });

  it('throws on a degenerate grid', () => {
    expect(() => validateCoverageRequest({ ...okRequest, grid: { ...grid, latCount: 0 } })).toThrow(/latCount/);
  });

  it('throws on a non-increasing or non-finite span', () => {
    expect(() => validateCoverageRequest({ ...okRequest, span: [10, 10] })).toThrow(/span/);
    expect(() => validateCoverageRequest({ ...okRequest, span: [0, NaN] })).toThrow(/span/);
  });

  it('throws on a non-positive step', () => {
    expect(() => validateCoverageRequest({ ...okRequest, step: 0 })).toThrow(/step/);
  });
});

describe('reduceCoverageSweep', () => {
  it('start resets to running with a zeroed bar and the total', () => {
    const prior = { status: 'done' as const, done: 12, total: 12 };
    expect(reduceCoverageSweep(prior, { kind: 'start', total: 12 })).toEqual({
      status: 'running',
      done: 0,
      total: 12,
    });
  });

  it('progress advances done while running and preserves the total', () => {
    const running = { status: 'running' as const, done: 0, total: 12 };
    const next = reduceCoverageSweep(running, { kind: 'progress', done: 5, fraction: 5 / 12 });
    expect(next.status).toBe('running');
    expect(next.done).toBe(5);
    expect(next.total).toBe(12);
  });

  it('result marks done and fills the bar', () => {
    const running = { status: 'running' as const, done: 5, total: 12 };
    const next = reduceCoverageSweep(running, { kind: 'result', cells: [], areaWeightedPercentCoverage: 0.5 });
    expect(next.status).toBe('done');
    expect(next.done).toBe(12);
  });

  it('error carries the located message', () => {
    const next = reduceCoverageSweep(INITIAL_COVERAGE_SWEEP, { kind: 'error', message: 'boom' });
    expect(next.status).toEqual({ error: 'boom' });
  });

  it('cancel returns to the idle slice', () => {
    const running = { status: 'running' as const, done: 5, total: 12 };
    expect(reduceCoverageSweep(running, { kind: 'cancel' })).toEqual(INITIAL_COVERAGE_SWEEP);
  });
});
