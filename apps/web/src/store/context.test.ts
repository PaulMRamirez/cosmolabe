import { describe, expect, it } from 'vitest';
import { createAppStore } from './app-state.ts';
import type { AnalysisContext } from './app-state.ts';

// The shared analysis context is a store slice patched by engine.setAnalysisContext
// (a shallow merge). The store-level behavior is tested here; the bar rendering and
// per-tool override are covered by the context e2e spec.

describe('shared analysis context', () => {
  it('defaults to a 1-day J2000 grid with tool-default target/observer', () => {
    const ctx = createAppStore().getState().analysisContext;
    expect(ctx).toEqual({ spanSec: 86400, stepSec: 120, target: '', observer: '', frame: 'J2000' });
  });

  it('shallow-merges a patch, leaving the other fields intact', () => {
    const store = createAppStore();
    const merge = (patch: Partial<AnalysisContext>): void =>
      store.setState((s) => ({ analysisContext: { ...s.analysisContext, ...patch } }));
    merge({ spanSec: 2 * 86400 });
    merge({ target: 'Saturn', frame: 'IAU_SATURN' });
    expect(store.getState().analysisContext).toEqual({
      spanSec: 2 * 86400,
      stepSec: 120,
      target: 'Saturn',
      observer: '',
      frame: 'IAU_SATURN',
    });
  });
});
