// The porkchop -> MCS cross-tab carrier (analysis-UX Phase 2, section 5.2): sendPorkchopToMcs
// appends an impulsive Maneuver to the editable MCS with the solved optimum's departure delta-v
// magnitude, so the trajectory designer flows porkchop -> MCS without re-typing the burn. These
// assert the append (one new Maneuver at the end carrying the solved magnitude), that it leaves
// the prior segments intact, and that it fails loud with no solved porkchop.

import { describe, it, expect } from 'vitest';
import { createAppStore } from '../store/index.ts';
import { sendPorkchopToMcs } from './analysis-ops.ts';
import type { PorkchopResult } from './porkchop.ts';

function seededPorkchop(deltaVKmS: number): PorkchopResult {
  return {
    departureEt: [0, 86400],
    tofSec: [100 * 86400, 200 * 86400],
    nodes: [],
    minDeltaVKmS: deltaVKmS,
    maxDeltaVKmS: deltaVKmS + 1,
    best: {
      departureIndex: 0,
      tofIndex: 1,
      departureEt: 0,
      tofSec: 200 * 86400,
      deltaVKmS,
      departureVelocity: { x: 30, y: 5, z: 0 },
      departureDeltaV: { x: 3, y: 0.4, z: 0 },
    },
    label: 'Earth -> Mars departure delta-v (km/s)',
  };
}

describe('sendPorkchopToMcs', () => {
  it('appends an impulsive Maneuver carrying the solved departure delta-v magnitude', () => {
    const store = createAppStore();
    const before = store.getState().editableMcs.segments.length;
    store.setState({ porkchop: seededPorkchop(3.6789) });

    sendPorkchopToMcs(store);

    const segs = store.getState().editableMcs.segments;
    expect(segs).toHaveLength(before + 1);
    const appended = segs[segs.length - 1]!;
    expect(appended.kind).toBe('Maneuver');
    expect(appended.kind === 'Maneuver' && appended.dvKmS).toBeCloseTo(3.6789, 6);
  });

  it('leaves the prior segments intact (a pure append)', () => {
    const store = createAppStore();
    const original = store.getState().editableMcs.segments;
    store.setState({ porkchop: seededPorkchop(1.0) });

    sendPorkchopToMcs(store);

    const segs = store.getState().editableMcs.segments;
    expect(segs.slice(0, original.length)).toEqual(original);
  });

  it('fails loud when there is no solved porkchop to send', () => {
    const store = createAppStore();
    expect(() => sendPorkchopToMcs(store)).toThrow(/no solved porkchop/);
  });
});
