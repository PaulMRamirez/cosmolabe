// keepSnapshot must enforce KEPT_SNAPSHOT_LIMIT against the freshest state with a
// single functional setState. The prior non-functional update read a length captured
// at the top of the method and spread a captured array, so a concurrent keep (e.g.
// triggered from a store subscriber while the first keep is mid-flight) could read a
// stale length and append past the cap.

import { describe, it, expect } from 'vitest';
import { BesselEngine } from './engine.ts';
import { createAppStore, KEPT_SNAPSHOT_LIMIT, type AppStore } from '../store/index.ts';

function engineWithConjunction(): { engine: BesselEngine; store: AppStore } {
  const store = createAppStore();
  store.setState({
    conjunction: { tcaSec: 10, missKm: 1.5, relSpeedKmS: 7, pc: 1e-4, sigmaKm: 1, radiusKm: 0.1, label: 'pair' },
  });
  // keepSnapshot touches only the store, never the scene/core, so a stub canvas is
  // enough to construct the engine (a test-double gap, not a production weakening).
  const engine = new BesselEngine({} as unknown as HTMLCanvasElement, store);
  return { engine, store };
}

describe('keepSnapshot limit enforcement', () => {
  it('never exceeds the cap, even on a keep that re-enters from a subscriber', () => {
    const { engine, store } = engineWithConjunction();

    // Fill the tray to one below the cap.
    for (let i = 0; i < KEPT_SNAPSHOT_LIMIT - 1; i += 1) engine.keepSnapshot('conjunction');
    expect(store.getState().keptSnapshots).toHaveLength(KEPT_SNAPSHOT_LIMIT - 1);

    // A subscriber that re-enters keepSnapshot once while the first keep is notifying:
    // with the old stale-snapshot update both appends would have landed (cap + 1).
    let reentered = false;
    const unsubscribe = store.subscribe(() => {
      if (!reentered) {
        reentered = true;
        engine.keepSnapshot('conjunction');
      }
    });
    engine.keepSnapshot('conjunction');
    unsubscribe();

    expect(store.getState().keptSnapshots.length).toBeLessThanOrEqual(KEPT_SNAPSHOT_LIMIT);
    expect(store.getState().keptSnapshots).toHaveLength(KEPT_SNAPSHOT_LIMIT);
  });

  it('is a no-op once the tray is full', () => {
    const { engine, store } = engineWithConjunction();
    for (let i = 0; i < KEPT_SNAPSHOT_LIMIT + 3; i += 1) engine.keepSnapshot('conjunction');
    expect(store.getState().keptSnapshots).toHaveLength(KEPT_SNAPSHOT_LIMIT);
  });

  it('does nothing when the tool has no result', () => {
    const store = createAppStore();
    const engine = new BesselEngine({} as unknown as HTMLCanvasElement, store);
    engine.keepSnapshot('conjunction');
    expect(store.getState().keptSnapshots).toEqual([]);
  });
});
