import { describe, it, expect } from 'vitest';
import type { ConjunctionEvent } from '@bessel/conjunction';
import {
  reduceScreening,
  validateScreeningRequest,
  ScreeningRequestError,
  INITIAL_SCREENING,
  type ScreeningRequest,
} from './screening-protocol.ts';

const okObjects = [
  { id: 'A', et: new Float64Array([0, 1]), pos: new Float64Array(6), vel: new Float64Array(6) },
  { id: 'B', et: new Float64Array([0, 1]), pos: new Float64Array(6), vel: new Float64Array(6) },
];

const event: ConjunctionEvent = {
  primaryId: 'A',
  secondaryId: 'B',
  tca: 12,
  missKm: 3,
  relSpeedKmS: 7,
  pc: null,
};

describe('validateScreeningRequest', () => {
  it('accepts a well-formed request', () => {
    const req: ScreeningRequest = { objects: okObjects, thresholdKm: 5, padKm: 50 };
    expect(() => validateScreeningRequest(req)).not.toThrow();
  });

  it('throws a located error on fewer than two objects', () => {
    expect(() => validateScreeningRequest({ objects: [okObjects[0]!], thresholdKm: 5, padKm: 50 })).toThrow(
      ScreeningRequestError,
    );
  });

  it('throws on a non-positive or non-finite threshold', () => {
    expect(() => validateScreeningRequest({ objects: okObjects, thresholdKm: 0, padKm: 50 })).toThrow(
      /thresholdKm/,
    );
    expect(() => validateScreeningRequest({ objects: okObjects, thresholdKm: NaN, padKm: 50 })).toThrow(
      /thresholdKm/,
    );
  });

  it('throws on a negative pad', () => {
    expect(() => validateScreeningRequest({ objects: okObjects, thresholdKm: 5, padKm: -1 })).toThrow(/padKm/);
  });
});

describe('reduceScreening', () => {
  it('start resets to running with a zeroed bar and clears prior events', () => {
    const prior = { status: 'done' as const, done: 4, total: 4, events: [event] };
    expect(reduceScreening(prior, { kind: 'start', total: 4 })).toEqual({
      status: 'running',
      done: 0,
      total: 4,
      events: null,
    });
  });

  it('progress advances done/total while running', () => {
    const next = reduceScreening(INITIAL_SCREENING, { kind: 'progress', done: 2, total: 4 });
    expect(next.status).toBe('running');
    expect(next.done).toBe(2);
    expect(next.total).toBe(4);
  });

  it('result lands the events, marks done, and fills the bar', () => {
    const running = { status: 'running' as const, done: 1, total: 4, events: null };
    const next = reduceScreening(running, { kind: 'result', events: [event] });
    expect(next.status).toBe('done');
    expect(next.events).toEqual([event]);
    expect(next.done).toBe(4);
  });

  it('error carries the located message', () => {
    const next = reduceScreening(INITIAL_SCREENING, { kind: 'error', message: 'boom' });
    expect(next.status).toEqual({ error: 'boom' });
  });

  it('cancel returns to the idle slice', () => {
    const running = { status: 'running' as const, done: 2, total: 4, events: null };
    expect(reduceScreening(running, { kind: 'cancel' })).toEqual(INITIAL_SCREENING);
  });
});
