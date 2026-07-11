// The per-event Pc card surfaces the Wave 2B carrier action (plan-avoidance-burn) and the keepable
// per-event snapshot (keep-conjunction-event) once an event is selected and its full-covariance Pc
// is computed. These render the card against a seeded ingest + per-event result slice.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { PcCard } from './PcCard.tsx';
import { createAppStore, type AppStore } from '../../store/index.ts';

const render = (store: AppStore): string =>
  renderToStaticMarkup(createElement(PcCard, { engine: null, store }));

function seededEvent(store: AppStore): void {
  store.setState({
    conjunctionIngest: { format: 'cdm', objectCount: 2, covarianceCount: 2, ids: ['A', 'B'], note: '' },
    selectedConjunctionEventId: 0,
    conjunctionEvent: {
      index: 0,
      primaryId: 'A',
      secondaryId: 'B',
      tca: 100,
      pcFull: 1.2e-4,
      pcMax: 3.4e-4,
      missXKm: 0.1,
      missYKm: 0.2,
      missKm: 0.3,
      radiusKm: 0.02,
      relSpeedKmS: 7,
      hasCovariance: true,
      ellipses: [],
      extentKm: 1,
    },
  });
}

describe('PcCard carrier + keep affordances (Wave 2B)', () => {
  it('renders the plan-avoidance-burn carrier and the keep-conjunction-event action for a selected event', () => {
    const store = createAppStore();
    seededEvent(store);
    const out = render(store);
    expect(out).toContain('data-testid="pc-result"');
    expect(out).toContain('data-testid="plan-avoidance-burn"');
    expect(out).toContain('data-testid="keep-conjunction-event"');
  });

  it('offers a Copy affordance for the Pc readouts on a selected event', () => {
    const store = createAppStore();
    seededEvent(store);
    const out = render(store);
    expect(out).toContain('data-testid="pc-copy"');
    expect(out).toContain('aria-label="Copy collision probability"');
  });

  it('renders the Export CDM action as a secondary (not ghost) button', () => {
    const store = createAppStore();
    seededEvent(store);
    const out = render(store);
    // The secondary variant paints a neutral surface (--bg-2); ghost is transparent.
    const exportIdx = out.indexOf('data-testid="export-cdm"');
    expect(exportIdx).toBeGreaterThan(-1);
    const tagStart = out.lastIndexOf('<button', exportIdx);
    const tagEnd = out.indexOf('>', exportIdx);
    expect(out.slice(tagStart, tagEnd)).toContain('var(--bg-2)');
  });

  it('shows neither carrier nor keep until an event is selected', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: { format: 'cdm', objectCount: 2, covarianceCount: 2, ids: ['A', 'B'], note: '' },
    });
    const out = render(store);
    expect(out).not.toContain('data-testid="plan-avoidance-burn"');
    expect(out).not.toContain('data-testid="keep-conjunction-event"');
  });
});
