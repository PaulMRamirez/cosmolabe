import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AnalysisPanel } from './AnalysisPanel.tsx';
import { createAppStore } from '../store/index.ts';

const html = (): string =>
  renderToStaticMarkup(
    createElement(AnalysisPanel, { engine: null, store: createAppStore(), hasSpacecraft: false }),
  );

describe('AnalysisPanel tool grouping (B10)', () => {
  it('groups the tools under seven labelled sections', () => {
    const out = html();
    for (const id of [
      'analysis-section-geometry',
      'analysis-section-access',
      'analysis-section-comms',
      'analysis-section-conjunction',
      'analysis-section-constellation',
      'analysis-section-maneuver',
      'analysis-section-export',
    ]) {
      expect(out).toContain(`data-testid="${id}"`);
    }
  });

  it('keeps every tool reachable (no tool dropped in the regroup)', () => {
    const out = html();
    for (const id of [
      'compute-range',
      'compute-groundtrack',
      'compute-access',
      'compute-eclipse',
      'compute-link',
      'compute-conjunction',
      'compute-constellation',
      'compute-slew',
      'compute-transfer',
      'export-oem',
    ]) {
      expect(out).toContain(`data-testid="${id}"`);
    }
  });

  it('promotes one amber primary action per section, the rest neutral', () => {
    const out = html();
    // selene Button renders its style (with background) after data-testid; a primary
    // button's background is var(--amber). Scan the button's own tag, bounded to before
    // the next testid so we do not read the following button's style.
    const isPrimary = (testId: string): boolean => {
      const idx = out.indexOf(`data-testid="${testId}"`);
      const after = out.slice(idx, idx + 600);
      const nextId = after.indexOf('data-testid=', 12);
      const tag = nextId > 0 ? after.slice(0, nextId) : after;
      return tag.includes('var(--amber)');
    };
    // One primary per section.
    for (const id of [
      'compute-range',
      'compute-access',
      'compute-link',
      'compute-conjunction',
      'compute-constellation',
      'compute-slew',
    ]) {
      expect(isPrimary(id), `${id} should be primary`).toBe(true);
    }
    // Secondary actions are not amber-filled.
    for (const id of ['compute-groundtrack', 'compute-eclipse', 'compute-transfer', 'export-oem']) {
      expect(isPrimary(id), `${id} should be secondary`).toBe(false);
    }
  });
});

describe('AnalysisPanel tool parameters', () => {
  it('renders an input form for each of the four configurable tools', () => {
    const out = html();
    for (const id of [
      // link budget
      'param-link-eirp',
      'param-link-freq',
      'param-link-gt',
      'param-link-rate',
      // conjunction covariance
      'param-conj-sigma',
      'param-conj-radius',
      // walker constellation
      'param-const-total',
      'param-const-planes',
      'param-const-phasing',
      'param-const-inc',
      'param-const-alt',
      'param-const-pattern',
      // attitude slew
      'param-slew-from',
      'param-slew-to',
      'param-slew-rate',
      'param-slew-accel',
    ]) {
      expect(out).toContain(`data-testid="${id}"`);
    }
  });
});

describe('AnalysisPanel CSV export', () => {
  it('offers a CSV export under every seeded result', () => {
    const store = createAppStore();
    const series = { et: new Float64Array([0, 60]), value: new Float64Array([1, 2]), label: 's' };
    store.setState({
      rangeSeries: series,
      linkSeries: series,
      slewSeries: series,
      groundTrack: {
        et: new Float64Array([0, 60]),
        lon: new Float64Array([0, 0.1]),
        lat: new Float64Array([0, 0.2]),
        label: 'gt',
      },
      conjunction: { tcaSec: 10, missKm: 5, relSpeedKmS: 1, pc: 1e-4, label: 'a vs b' },
      constellation: {
        totalSats: 24,
        planes: 3,
        perPlane: 8,
        pattern: 'delta',
        phasing: 1,
        inclinationDeg: 53,
        altitudeKm: 700,
      },
      transfer: { deltaVKmS: 0.1, tofHours: 2, label: 'arc' },
    });
    const out = renderToStaticMarkup(
      createElement(AnalysisPanel, { engine: null, store, hasSpacecraft: true }),
    );
    for (const id of [
      'range-csv',
      'link-csv',
      'slew-csv',
      'groundtrack-csv',
      'conjunction-csv',
      'constellation-csv',
      'transfer-csv',
    ]) {
      expect(out).toContain(`data-testid="${id}"`);
    }
  });
});

describe('AnalysisPanel result tables (B18)', () => {
  it('renders the chart/table toolbar and table over a seeded series and interval', () => {
    const store = createAppStore();
    store.setState({
      rangeSeries: {
        et: new Float64Array([0, 60]),
        value: new Float64Array([10, 20]),
        label: 'range (km)',
      },
      accessResult: {
        window: [[0, 100]],
        span: [0, 200],
        label: 'Probe to SUN',
        fom: { percentCoverage: 0.5, accessCount: 1, maxGapSec: 100 },
      },
    });
    const out = renderToStaticMarkup(
      createElement(AnalysisPanel, { engine: null, store, hasSpacecraft: true }),
    );
    // Toolbar + table testids derive from each block's result testid.
    expect(out).toContain('data-testid="range-result-toolbar"');
    expect(out).toContain('data-testid="range-result-view-table"');
    expect(out).toContain('data-testid="range-result-copy"');
    expect(out).toContain('data-testid="range-result-precision"');
    expect(out).toContain('data-testid="access-result-toolbar"');
    // Chart is the default view, with both view toggles present.
    expect(out).toContain('data-testid="range-result-view-chart"');
    expect(out).toContain('data-testid="range-result-view-table"');
  });
});
