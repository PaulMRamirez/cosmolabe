import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { StationRegistryControl } from './StationRegistryControl.tsx';
import { AnalysisContextBar } from './AnalysisContextBar.tsx';
import { createAppStore, type AppStore } from '../store/index.ts';

// The ground-station registry is first-class shared context: the control lives in the analysis
// context bar (data-testid station-registry). These tests assert it renders, lists seeded stations,
// surfaces the add form, and notes the active station. The engine dispatch is exercised by the
// reducer unit test; here we assert the presentational surface (engine = null).

const control = (store: AppStore): string =>
  renderToStaticMarkup(createElement(StationRegistryControl, { engine: null, store }));

describe('StationRegistryControl', () => {
  it('renders the registry control with the station select and add toggle', () => {
    const out = control(createAppStore());
    expect(out).toContain('data-testid="station-registry"');
    expect(out).toContain('data-testid="station-select"');
    expect(out).toContain('data-testid="station-add-toggle"');
    // The add form is collapsed by default (no name field until the toggle is pressed).
    expect(out).not.toContain('data-testid="station-name"');
  });

  it('lists seeded stations and notes the active one', () => {
    const store = createAppStore();
    store.setState((s) => ({
      scenario: {
        ...s.scenario,
        stations: [{ id: 'dss-14', name: 'Goldstone', lonRad: -2, latRad: 0.6, altKm: 1, minElevationRad: 0.175 }],
        activeStationId: 'dss-14',
      },
    }));
    const out = control(store);
    expect(out).toContain('Goldstone');
    expect(out).toContain('data-testid="station-active-note"');
    expect(out).toContain('data-testid="station-remove"');
  });

  it('renders a per-station Edit control for the active station only when onUpdateStation is wired', () => {
    const store = createAppStore();
    store.setState((s) => ({
      scenario: {
        ...s.scenario,
        stations: [{ id: 'dss-14', name: 'Goldstone', lonRad: -2, latRad: 0.6, altKm: 1, minElevationRad: 0.175 }],
        activeStationId: 'dss-14',
      },
    }));
    // Without the update prop the Edit affordance is absent (the parent has not wired it).
    expect(control(store)).not.toContain('data-testid="station-edit-dss-14"');
    // With it wired, the per-row Edit control appears keyed by the active station id.
    const withEdit = renderToStaticMarkup(
      createElement(StationRegistryControl, { engine: null, store, onUpdateStation: () => {} }),
    );
    expect(withEdit).toContain('data-testid="station-edit-dss-14"');
  });
});

describe('AnalysisContextBar embeds the station registry', () => {
  it('renders the registry control inside the shared context bar', () => {
    const out = renderToStaticMarkup(createElement(AnalysisContextBar, { engine: null, store: createAppStore() }));
    expect(out).toContain('data-testid="analysis-context-bar"');
    expect(out).toContain('data-testid="station-registry"');
  });
});
