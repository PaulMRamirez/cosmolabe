import { describe, expect, it } from 'vitest';
import { createAppStore } from './app-state.ts';
import type { GroundStation, ScenarioState } from './app-state.ts';

// The Scenario Object Model is a typed store slice of role slots (committed fix 1 of
// the analysis-UX design). Phase 0.1 adds the slice and its empty default only; the
// context-bar controls and per-card reads land in Phase 0.2. These tests pin the
// default shape and a setState round-trip; no UI is wired yet.

describe('scenario object model slice', () => {
  it('defaults to empty role slots', () => {
    const scenario = createAppStore().getState().scenario;
    expect(scenario).toEqual({
      primarySpacecraft: null,
      secondaryObjects: [],
      stations: [],
      activeStationId: null,
      observationTarget: null,
      assetSet: [],
    } satisfies ScenarioState);
  });

  it('round-trips a patched slice through setState, leaving other slices intact', () => {
    const store = createAppStore();
    const station: GroundStation = {
      id: 'dss-14',
      name: 'Goldstone DSS-14',
      lonRad: -2.0,
      latRad: 0.62,
      altKm: 1.0,
      minElevationRad: 0.17,
    };
    store.setState((s) => ({
      scenario: {
        ...s.scenario,
        primarySpacecraft: 'Cassini',
        secondaryObjects: ['Saturn'],
        stations: [station],
        activeStationId: 'dss-14',
        observationTarget: 'Titan',
        assetSet: ['sat-1', 'sat-2'],
      },
    }));
    expect(store.getState().scenario).toEqual({
      primarySpacecraft: 'Cassini',
      secondaryObjects: ['Saturn'],
      stations: [station],
      activeStationId: 'dss-14',
      observationTarget: 'Titan',
      assetSet: ['sat-1', 'sat-2'],
    });
    // The additive slice does not perturb the existing shared context default.
    expect(store.getState().analysisContext.frame).toBe('J2000');
  });
});
