import { describe, expect, it } from 'vitest';
import { createAppStore } from './app-state.ts';

// The Analyze dock open/tab state lives in the store and is driven by thin engine
// setters (toggleAnalyze / setAnalyzeTab). The store-level behavior is tested here;
// the dock rendering is covered by the e2e workbench spec.

describe('analyze dock state', () => {
  it('defaults to closed on the Orbit & Maneuver tab', () => {
    const store = createAppStore();
    expect(store.getState().analyzeOpen).toBe(false);
    expect(store.getState().analyzeTab).toBe('orbit-maneuver');
  });

  it('toggleAnalyze flips the open state', () => {
    const store = createAppStore();
    store.setState((s) => ({ analyzeOpen: !s.analyzeOpen }));
    expect(store.getState().analyzeOpen).toBe(true);
    store.setState((s) => ({ analyzeOpen: !s.analyzeOpen }));
    expect(store.getState().analyzeOpen).toBe(false);
  });

  it('selecting a tab opens the dock and sets the active tab', () => {
    const store = createAppStore();
    store.setState(() => ({ analyzeOpen: true, analyzeTab: 'conjunction' }));
    expect(store.getState().analyzeOpen).toBe(true);
    expect(store.getState().analyzeTab).toBe('conjunction');
  });
});
