import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { CompareTray } from './CompareTray.tsx';
import { createAppStore, KEPT_SNAPSHOT_LIMIT } from '../store/index.ts';

describe('CompareTray (B21)', () => {
  it('shows an empty hint with no kept snapshots', () => {
    const out = renderToStaticMarkup(
      createElement(CompareTray, { engine: null, store: createAppStore() }),
    );
    expect(out).toContain('data-testid="compare-empty"');
  });

  it('tabulates kept snapshots per domain with remove + export controls', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: [
        { id: 'snap-1', domain: 'access', label: 'access 1', metrics: { 'coverage %': '80.0' } },
        { id: 'snap-2', domain: 'access', label: 'access 2', metrics: { 'coverage %': '72.0' } },
      ],
    });
    const out = renderToStaticMarkup(createElement(CompareTray, { engine: null, store }));
    expect(out).toContain('data-testid="compare-table"');
    expect(out).toContain('access 1');
    expect(out).toContain('access 2');
    expect(out).toContain('80.0');
    expect(out).toContain('data-testid="snapshot-remove-snap-1"');
    expect(out).toContain('data-testid="compare-csv"');
    expect(out).toContain('data-testid="compare-clear"');
  });

  it('keeps the chip label non-interactive and confines removal to the ✕ button', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: [
        { id: 'snap-1', domain: 'access', label: 'access 1', metrics: { 'coverage %': '80.0' } },
      ],
    });
    const out = renderToStaticMarkup(createElement(CompareTray, { engine: null, store }));
    // The label is a plain span (the chip container is not a button), so clicking the
    // variant name cannot destroy the snapshot.
    expect(out).toContain('class="bessel-snapshot-chip-label"');
    // The remove control is the dedicated ✕ button, carrying the testid and accessible name.
    expect(out).toContain('data-testid="snapshot-remove-snap-1"');
    expect(out).toContain('aria-label="Remove access 1 from compare"');
  });

  it('shows a kept-count badge without a full note below the limit', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: [
        { id: 'snap-1', domain: 'access', label: 'access 1', metrics: { 'coverage %': '80.0' } },
      ],
    });
    const out = renderToStaticMarkup(createElement(CompareTray, { engine: null, store }));
    expect(out).toContain('data-testid="compare-kept-count"');
    expect(out).toContain(`Kept 1 / ${KEPT_SNAPSHOT_LIMIT}`);
    expect(out).not.toContain('data-testid="compare-tray-full"');
  });

  it('shows the "Tray full" note when kept snapshots reach the limit', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: Array.from({ length: KEPT_SNAPSHOT_LIMIT }, (_, i) => ({
        id: `snap-${i}`,
        domain: 'access' as const,
        label: `access ${i}`,
        metrics: { 'coverage %': '80.0' },
      })),
    });
    const out = renderToStaticMarkup(createElement(CompareTray, { engine: null, store }));
    expect(out).toContain(`Kept ${KEPT_SNAPSHOT_LIMIT} / ${KEPT_SNAPSHOT_LIMIT}`);
    expect(out).toContain('data-testid="compare-tray-full"');
  });

  it('renders one grouped table per domain when snapshots span domains', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: [
        { id: 'snap-1', domain: 'access', label: 'access 1', metrics: { 'coverage %': '80.0', passes: 5 } },
        { id: 'snap-2', domain: 'lighting', label: 'lighting-beta 2', metrics: { 'beta min (deg)': '12.0' } },
      ],
    });
    const out = renderToStaticMarkup(createElement(CompareTray, { engine: null, store }));
    // One section per domain, each with its own grouped table.
    expect(out).toContain('data-testid="compare-domain-access"');
    expect(out).toContain('data-testid="compare-domain-lighting"');
    expect(out).toContain('coverage %');
    expect(out).toContain('beta min (deg)');
  });
});
