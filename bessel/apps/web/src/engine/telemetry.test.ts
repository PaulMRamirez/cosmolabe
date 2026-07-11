// pushReadouts must not let an older in-flight computeReadouts (a worker round-trip
// that resolves out of order) overwrite a newer focus's readouts. A monotonic seq id
// gates the write so only the latest-issued request lands.

import { describe, it, expect } from 'vitest';
import type { SpiceEngine } from '@bessel/spice';
import { createAppStore } from '../store/index.ts';
import { pushReadouts } from './telemetry.ts';

// A mock SPICE whose spkpos resolution is deferred per target so the test controls
// the order in which two in-flight requests resolve. The returned range encodes the
// target (x = 1000 for "First", 2000 for "Second"), so we can assert which focus's
// readouts won the write. subpnt throws so the illumination angles stay n/a.
function deferredSpice(): { spice: SpiceEngine; resolve: (target: string) => void } {
  const gates = new Map<string, () => void>();
  const engine = {
    spkpos: (target: string) =>
      new Promise((res) => {
        const x = target === 'First' ? 1000 : 2000;
        gates.set(target, () => res({ position: { x, y: 0, z: 0 }, lightTime: 0 }));
      }),
    bodvrd: async () => {
      throw new Error('no radii');
    },
    subpnt: async () => {
      throw new Error('no frame');
    },
    ilumin: async () => ({ phase: 0, incidence: 0, emission: 0 }),
  };
  return {
    spice: engine as unknown as SpiceEngine,
    resolve: (target: string) => gates.get(target)?.(),
  };
}

// Let all pending microtasks (the computeReadouts await chain) settle.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('pushReadouts ordering guard', () => {
  it('drops a stale earlier request that resolves after a newer one', async () => {
    const { spice, resolve } = deferredSpice();
    const store = createAppStore();
    const frames = new Map<string, string>();
    const notDisposed = (): boolean => false;

    // Issue the older request (focus "First"), then the newer one (focus "Second").
    pushReadouts(spice, store, 'First', 'Probe', 0, frames, notDisposed);
    pushReadouts(spice, store, 'Second', 'Probe', 0, frames, notDisposed);

    // The newer request resolves first and writes its readouts.
    resolve('Second');
    await flush();
    expect(store.getState().readouts?.rangeKm).toBe(2000);

    // The older request resolves last; the guard must keep the newer readouts rather
    // than flashing the previous focus's value back.
    resolve('First');
    await flush();
    expect(store.getState().readouts?.rangeKm).toBe(2000);
  });

  it('does nothing when there is no observer (neutral scene)', () => {
    const { spice } = deferredSpice();
    const store = createAppStore();
    const before = store.getState().readouts;
    pushReadouts(spice, store, 'First', null, 0, new Map(), () => false);
    expect(store.getState().readouts).toBe(before);
  });
});
