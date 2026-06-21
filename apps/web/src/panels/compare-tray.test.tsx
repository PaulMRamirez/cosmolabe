import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { CompareTray } from './CompareTray.tsx';
import { createAppStore } from '../store/index.ts';

describe('CompareTray (B21)', () => {
  it('shows an empty hint with no kept snapshots', () => {
    const out = renderToStaticMarkup(
      createElement(CompareTray, { engine: null, store: createAppStore() }),
    );
    expect(out).toContain('data-testid="compare-empty"');
  });

  it('tabulates kept snapshots per tool with remove + export controls', () => {
    const store = createAppStore();
    store.setState({
      keptSnapshots: [
        { id: 'snap-1', tool: 'access', name: 'access 1', metrics: [{ label: 'coverage %', value: '80.0' }] },
        { id: 'snap-2', tool: 'access', name: 'access 2', metrics: [{ label: 'coverage %', value: '72.0' }] },
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
});
