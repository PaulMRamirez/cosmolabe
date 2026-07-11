// Static-markup structure test for the grammar demo panel (the app's
// node-env pattern: renderToStaticMarkup, no DOM). Live behavior (jobs,
// partial streaming, cancel, drapes) is driven by the Playwright spec.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GrammarPanel } from './GrammarPanel.tsx';
import { createStore } from '../store/create-store.ts';
import { initialAppState, type AppState } from '../store/app-state.ts';

describe('GrammarPanel', () => {
  it('renders the four product-kind cards with run controls and testids', () => {
    const store = createStore<AppState>(initialAppState);
    const html = renderToStaticMarkup(<GrammarPanel engine={null} store={store} />);
    for (const kind of ['gs2-access', 'gs2-series', 'gs2-track', 'gs4-field', 'gs4-access']) {
      expect(html).toContain(`grammar-card-${kind}`);
      expect(html).toContain(`grammar-run-${kind}`);
    }
    expect(html).toContain('grammar-kernel-hash');
    expect(html).toContain('progress-ring');
  });

  it('shows lanes, chart, and drape notes once products land in the store', () => {
    const store = createStore<AppState>({
      ...initialAppState,
      grammar: {
        ...initialAppState.grammar,
        intervals: { 'gs2-access': { sets: [{ label: 'CASSINI', intervals: [[0, 10]] }], span: [0, 100] } },
        series: { name: 'range', unit: 'km', et: Float64Array.from([0, 1]), values: Float64Array.from([1, 2]) },
        trackPoints: 42,
        fieldCellsResolved: 12,
        fieldCellsTotal: 40,
      },
    });
    const html = renderToStaticMarkup(<GrammarPanel engine={null} store={store} />);
    expect(html).toContain('grammar-lane-CASSINI');
    expect(html).toContain('grammar-series-chart');
    expect(html).toContain('42');
    expect(html).toContain('12');
  });
});
