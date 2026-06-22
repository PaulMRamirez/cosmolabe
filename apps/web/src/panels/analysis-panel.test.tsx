import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { LightingGeometryPanel } from './LightingGeometryPanel.tsx';
import { betaCard, eclipseCard, solarIntensityCard } from './lighting-cards.tsx';
import { AccessCommsPanel } from './AccessCommsPanel.tsx';
import { ConjunctionPanel } from './ConjunctionPanel.tsx';
import { CoveragePanel } from './CoveragePanel.tsx';
import { createAppStore, type AppStore } from '../store/index.ts';

// The former monolithic AnalysisPanel is re-slotted into intent-named domain panels, with
// each tool wrapped in a collapsible TaskCard (a collapsed card does not render its body).
// These tests assert the re-slot preserved every tool's reachability (its card toggle is
// present) and that an expanded card still renders the tool and its seeded result/testids.

const lighting = (store: AppStore, hasSpacecraft = false): string =>
  renderToStaticMarkup(createElement(LightingGeometryPanel, { engine: null, store, hasSpacecraft }));
const access = (store: AppStore, hasSpacecraft = false): string =>
  renderToStaticMarkup(createElement(AccessCommsPanel, { engine: null, store, hasSpacecraft }));
const conjunction = (store: AppStore, hasSpacecraft = false): string =>
  renderToStaticMarkup(createElement(ConjunctionPanel, { engine: null, store, hasSpacecraft }));
const coverage = (store: AppStore, hasSpacecraft = false): string =>
  renderToStaticMarkup(createElement(CoveragePanel, { engine: null, store, hasSpacecraft }));

describe('domain panels group the tools into TaskCards (B10 re-slot)', () => {
  it('renders an accordion with a card toggle for every re-slotted tool', () => {
    // Every tool is reachable via its TaskCard toggle, even when collapsed.
    const cardsByPanel: readonly [string, readonly string[]][] = [
      [lighting(createAppStore()), ['range', 'ground-track', 'beta', 'eclipse', 'solar-intensity']],
      [access(createAppStore()), ['access', 'in-fov', 'link']],
      [conjunction(createAppStore()), ['closest-approach', 'catalog-screen', 'per-event-pc']],
      [coverage(createAppStore()), ['constellation', 'coverage-grid']],
    ];
    for (const [out, ids] of cardsByPanel) {
      expect(out).toContain('data-testid="taskcard-accordion"');
      for (const id of ids) {
        expect(out, `card ${id} toggle`).toContain(`data-testid="taskcard-${id}-toggle"`);
      }
    }
  });

  it('keeps each panel under the at-most-two-expanded cap on first render', () => {
    for (const out of [
      lighting(createAppStore()),
      access(createAppStore()),
      conjunction(createAppStore()),
      coverage(createAppStore()),
    ]) {
      const open = (out.match(/aria-expanded="true"/g) ?? []).length;
      expect(open).toBeLessThanOrEqual(2);
    }
  });
});

describe('domain panels surface the tools in their default-expanded cards', () => {
  it('renders the default-expanded tools (no tool dropped in the regroup)', () => {
    expect(lighting(createAppStore())).toContain('data-testid="compute-range"');
    expect(lighting(createAppStore())).toContain('data-testid="compute-groundtrack"');
    expect(access(createAppStore())).toContain('data-testid="compute-access"');
    expect(access(createAppStore())).toContain('data-testid="compute-link"');
    // The Conjunction tab now default-expands the REAL ingest + per-event Pc cards (Phase 1):
    // the ingest card carries the format select, the paste input, and the screen action.
    expect(conjunction(createAppStore())).toContain('data-testid="ingest-catalog"');
    expect(conjunction(createAppStore())).toContain('data-testid="ingest-format"');
    expect(conjunction(createAppStore())).toContain('data-testid="ingest-input"');
    expect(conjunction(createAppStore())).toContain('data-testid="screen-catalog"');
    expect(coverage(createAppStore())).toContain('data-testid="compute-constellation"');
    expect(coverage(createAppStore())).toContain('data-testid="compute-coverage-grid"');
    expect(coverage(createAppStore())).toContain('data-testid="clear-coverage-grid"');
  });

  it('promotes one amber primary action per expanded card, secondaries neutral', () => {
    const isPrimary = (out: string, testId: string): boolean => {
      const idx = out.indexOf(`data-testid="${testId}"`);
      if (idx < 0) return false;
      const after = out.slice(idx, idx + 600);
      const nextId = after.indexOf('data-testid=', 12);
      const tag = nextId > 0 ? after.slice(0, nextId) : after;
      return tag.includes('var(--amber)');
    };
    expect(isPrimary(lighting(createAppStore()), 'compute-range')).toBe(true);
    expect(isPrimary(lighting(createAppStore()), 'compute-groundtrack')).toBe(false);
    expect(isPrimary(access(createAppStore()), 'compute-access')).toBe(true);
    expect(isPrimary(access(createAppStore()), 'compute-link')).toBe(true);
    // The Conjunction tab's default-expanded ingest card promotes the Ingest action as primary.
    expect(isPrimary(conjunction(createAppStore()), 'ingest-run')).toBe(true);
    expect(isPrimary(coverage(createAppStore()), 'compute-constellation')).toBe(true);
  });
});

describe('Coverage panel coverage-grid overlay toggle', () => {
  it('renders the show + clear toggles in the coverage card', () => {
    const out = coverage(createAppStore());
    expect(out).toContain('data-testid="compute-coverage-grid"');
    expect(out).toContain('data-testid="clear-coverage-grid"');
  });

  it('shows the area-weighted summary once a coverage grid is seeded', () => {
    const store = createAppStore();
    store.setState({
      coverageGrid: {
        cellCount: 162,
        areaWeightedPercentCoverage: 0.42,
        label: 'Probe over EARTH',
        assetCount: 1,
        metric: null,
        summary: null,
      },
    });
    expect(coverage(store, true)).toContain('data-testid="coverage-grid-stat"');
  });
});

describe('Coverage panel: the Walker -> sweep -> metric-aware contour workflow', () => {
  it('renders the coverage sweep form with the resolution, metric, and N-fold controls', () => {
    const out = coverage(createAppStore());
    for (const id of ['param-grid-resolution', 'param-fom-metric', 'param-nfold']) {
      expect(out).toContain(`data-testid="${id}"`);
    }
    // The sweep action is relabelled (it now sweeps the asset set, not a fixed global grid).
    expect(out).toContain('data-testid="coverage-asset-note"');
  });

  it('notes the designed asset set feeds the sweep once a constellation is designed', () => {
    const store = createAppStore();
    store.setState({
      designedConstellation: { assetIds: ['-970001', '-970002', '-970003'], totalSats: 3, planes: 1, perPlane: 3 },
    });
    expect(coverage(store, true)).toContain('3-satellite Walker asset set');
  });

  it('renders the metric-aware contour legend and the FOM summary table after a sweep', () => {
    const store = createAppStore();
    store.setState({
      coverageGrid: {
        cellCount: 50,
        areaWeightedPercentCoverage: 0.6,
        label: '3 assets over EARTH',
        assetCount: 3,
        metric: { id: 'revisitMax', label: 'Max revisit gap', unit: 'min', nFoldK: 2 },
        summary: {
          cellCount: 50,
          areaWeightedPercentCoverage: 0.6,
          minPercentCoverage: 0.1,
          meanPercentCoverage: 0.6,
          maxPercentCoverage: 0.9,
          worstRevisitMaxSec: 600,
          worstResponseTimeSec: 120,
          nFoldCellFraction: 0.4,
          nFoldK: 2,
        },
      },
    });
    const out = coverage(store, true);
    expect(out).toContain('data-testid="coverage-contour-legend"');
    expect(out).toContain('data-testid="coverage-legend-metric"');
    expect(out).toContain('Max revisit gap');
    expect(out).toContain('data-testid="coverage-fom-summary"');
    expect(out).toContain('data-testid="coverage-fom-csv"');
  });
});

describe('domain panel tool parameter forms', () => {
  it('renders the link, conjunction, and constellation forms in their expanded cards', () => {
    for (const id of ['param-link-eirp', 'param-link-freq', 'param-link-gt', 'param-link-rate']) {
      expect(access(createAppStore())).toContain(`data-testid="${id}"`);
    }
    // The single-pair closest-approach card (carrying the sigma/radius form) is now collapsed by
    // default (the REAL ingest + per-event cards take the two expanded slots); assert its toggle
    // is present so the form stays reachable.
    expect(conjunction(createAppStore())).toContain('data-testid="taskcard-closest-approach-toggle"');
    for (const id of [
      'param-const-total',
      'param-const-planes',
      'param-const-phasing',
      'param-const-inc',
      'param-const-alt',
      'param-const-pattern',
    ]) {
      expect(coverage(createAppStore())).toContain(`data-testid="${id}"`);
    }
  });
});

describe('domain panel CSV export', () => {
  it('offers a CSV export under each seeded result in an expanded card', () => {
    const series = { et: new Float64Array([0, 60]), value: new Float64Array([1, 2]), label: 's' };
    const lightStore = createAppStore();
    lightStore.setState({
      rangeSeries: series,
      groundTrack: {
        et: new Float64Array([0, 60]),
        lon: new Float64Array([0, 0.1]),
        lat: new Float64Array([0, 0.2]),
        label: 'gt',
      },
    });
    const lightOut = lighting(lightStore, true);
    expect(lightOut).toContain('data-testid="range-csv"');
    expect(lightOut).toContain('data-testid="groundtrack-csv"');

    const accessStore = createAppStore();
    accessStore.setState({ linkSeries: series });
    expect(access(accessStore, true)).toContain('data-testid="link-csv"');

    // The single-pair closest-approach CSV lives in the now-collapsed closest-approach card; its
    // toggle keeps it reachable (the per-event Pc + ingest cards take the expanded slots).
    const conjStore = createAppStore();
    conjStore.setState({
      conjunction: { tcaSec: 10, missKm: 5, relSpeedKmS: 1, pc: 1e-4, sigmaKm: 1, radiusKm: 0.1, label: 'a vs b' },
    });
    expect(conjunction(conjStore, true)).toContain('data-testid="taskcard-closest-approach-toggle"');

    const covStore = createAppStore();
    covStore.setState({
      constellation: {
        totalSats: 24,
        planes: 3,
        perPlane: 8,
        pattern: 'delta',
        phasing: 1,
        inclinationDeg: 53,
        altitudeKm: 700,
      },
    });
    expect(coverage(covStore, true)).toContain('data-testid="constellation-csv"');
  });
});

describe('Conjunction panel REAL ingestion + screening (worker)', () => {
  it('renders the ingest card (format select + paste input) and the screen action', () => {
    const out = conjunction(createAppStore());
    expect(out).toContain('data-testid="ingest-catalog"');
    expect(out).toContain('data-testid="ingest-format"');
    expect(out).toContain('data-testid="ingest-input"');
    expect(out).toContain('data-testid="screen-catalog"');
  });

  it('shows the progress readout and cancel button while a screen runs', () => {
    const store = createAppStore();
    store.setState({ screening: { status: 'running', done: 2, total: 4, epoch: 0, events: null } });
    const out = conjunction(store, true);
    expect(out).toContain('data-testid="screen-progress"');
    expect(out).toContain('data-testid="screen-cancel"');
    expect(out).toContain('Screening 2/4');
  });

  it('shows the ingest summary once a catalog is ingested', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: {
        format: 'cdm',
        objectCount: 2,
        covarianceCount: 2,
        ids: ['PRIMARY-A', 'SECONDARY-B'],
        note: '2 CDM objects, 2 with covariance',
      },
    });
    const out = conjunction(store, true);
    expect(out).toContain('data-testid="ingest-summary"');
    expect(out).toContain('PRIMARY-A');
    expect(out).toContain('SECONDARY-B');
  });

  it('lists the flagged events in the per-event table with TCA relative to the catalog epoch', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: {
        format: 'cdm',
        objectCount: 2,
        covarianceCount: 2,
        ids: ['CHASER', 'TARGET'],
        note: '2 CDM objects',
      },
      screening: {
        status: 'done',
        done: 4,
        total: 4,
        // The grid epoch is 120 s; the event's absolute TCA is 600 s, so the table must show the
        // relative TCA (600 - 120) / 60 = 8 min, not the absolute 600 / 60 = 10 min.
        epoch: 120,
        events: [{ primaryId: 'CHASER', secondaryId: 'TARGET', tca: 600, missKm: 1.2, relSpeedKmS: 0.5, pc: null }],
      },
    });
    const out = conjunction(store, true);
    expect(out).toContain('data-testid="event-table"');
    expect(out).toContain('data-testid="conjunction-event-0"');
    expect(out).toContain('CHASER vs TARGET');
    expect(out).toContain('8</td>');
    expect(out).not.toContain('10</td>');
  });

  it('renders the per-event Pc readouts and the B-plane view for a selected event', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: { format: 'cdm', objectCount: 2, covarianceCount: 2, ids: ['A', 'B'], note: '' },
      conjunctionEvent: {
        index: 0,
        primaryId: 'A',
        secondaryId: 'B',
        tca: 600,
        pcFull: 1.2e-4,
        pcMax: 3.4e-4,
        missXKm: 1.5,
        missYKm: 0.5,
        missKm: 1.58,
        radiusKm: 0.01,
        relSpeedKmS: 0.12,
        hasCovariance: true,
        ellipses: [
          { sigma: 1, semiMajorKm: 0.2, semiMinorKm: 0.1, angleRad: 0 },
          { sigma: 3, semiMajorKm: 0.6, semiMinorKm: 0.3, angleRad: 0 },
        ],
        extentKm: 2,
      },
    });
    const out = conjunction(store, true);
    expect(out).toContain('data-testid="pc-full"');
    expect(out).toContain('data-testid="pc-max"');
    expect(out).toContain('data-testid="bplane-view"');
    expect(out).toContain('data-testid="bplane-ellipse-1sigma"');
    expect(out).toContain('data-testid="bplane-ellipse-3sigma"');
    expect(out).toContain('data-testid="bplane-miss"');
    expect(out).toContain('data-testid="bplane-hardbody"');
  });
});

describe('domain panel result tables (B18)', () => {
  it('renders the chart/table toolbar and table over a seeded series and interval', () => {
    const store = createAppStore();
    store.setState({
      rangeSeries: {
        et: new Float64Array([0, 60]),
        value: new Float64Array([10, 20]),
        label: 'range (km)',
      },
    });
    const out = lighting(store, true);
    // Toolbar + table testids derive from the result testid.
    expect(out).toContain('data-testid="range-result-toolbar"');
    expect(out).toContain('data-testid="range-result-view-table"');
    expect(out).toContain('data-testid="range-result-copy"');
    expect(out).toContain('data-testid="range-result-precision"');
    expect(out).toContain('data-testid="range-result-view-chart"');

    const accessStore = createAppStore();
    accessStore.setState({
      accessResult: {
        window: [[0, 100]],
        span: [0, 200],
        label: 'Probe to SUN',
        fom: { percentCoverage: 0.5, accessCount: 1, maxGapSec: 100 },
      },
    });
    expect(access(accessStore, true)).toContain('data-testid="access-result-toolbar"');
  });
});

describe('Access constraint stack + in-FOV pointing (Phase 1)', () => {
  it('renders the constraint-stack form with a toggle for each live constraint kind', () => {
    const out = access(createAppStore());
    expect(out).toContain('data-testid="access-constraint-form"');
    for (const id of ['constraint-los', 'constraint-range', 'constraint-rangerate', 'constraint-sunkeepout']) {
      expect(out, `toggle ${id}`).toContain(`data-testid="${id}"`);
    }
  });

  it('gates the facility/DEM constraints as disabled advanced toggles (Phase 2)', () => {
    const out = access(createAppStore());
    expect(out).toContain('data-testid="constraint-azelmask"');
    expect(out).toContain('data-testid="constraint-terrainlos"');
    expect(out).toContain('Phase 2');
    // Both advanced toggles render disabled (not faked from the current scenario).
    const disabledCount = (out.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(2);
  });

  it('shows the surviving window plus a per-constraint breakdown once seeded', () => {
    const store = createAppStore();
    store.setState({
      accessResult: {
        window: [[0, 100]],
        span: [0, 200],
        label: 'Probe to SUN',
        fom: { percentCoverage: 0.5, accessCount: 1, maxGapSec: 100 },
      },
      accessBreakdown: [
        {
          label: 'Line of sight (not occulted by Earth)',
          fom: { percentCoverage: 0.6, accessCount: 1, maxGapSec: 80 },
        },
      ],
    });
    const out = access(store, true);
    expect(out).toContain('data-testid="access-breakdown"');
    expect(out).toContain('data-testid="access-breakdown-item"');
    expect(out).toContain('Line of sight');
  });

  it('keeps the in-FOV card reachable via its toggle (collapsed by default)', () => {
    // The in-fov card is collapsed by default (only access + link are default-expanded), but it
    // is reachable via its toggle; its body (pointing select) renders when expanded, asserted e2e.
    const out = access(createAppStore());
    expect(out).toContain('data-testid="taskcard-in-fov-toggle"');
    expect(out).not.toContain('data-testid="param-fov-pointing"');
  });
});

describe('the empty notice surfaces when no spacecraft is loaded', () => {
  it('shows the load-a-spacecraft notice on the domain panels', () => {
    expect(lighting(createAppStore(), false)).toContain('data-testid="analysis-empty-notice"');
    expect(access(createAppStore(), false)).toContain('data-testid="analysis-empty-notice"');
    expect(lighting(createAppStore(), true)).not.toContain('data-testid="analysis-empty-notice"');
  });
});

// The Lighting & Geometry Phase-1 cards (beta season, full eclipse phases, solar
// intensity). The card bodies are rendered directly (the accordion only expands two by
// default, and an expandRequest needs an effect that static markup does not run), so each
// card's run action, seeded result, units/interpretation hint, and CSV export are
// asserted against a seeded slice.
const ctx = (status: Record<string, 'idle' | 'running' | 'ok' | { error: string }> = {}) => ({
  engine: null,
  span: { spanSec: 86400, stepSec: 120 },
  runStatus: status,
  runMeta: {},
});
const renderCard = (node: ReactNode): string => renderToStaticMarkup(createElement('div', null, node));

describe('Lighting & Geometry Phase-1 cards surface beta / eclipse phases / solar intensity', () => {
  it('renders the beta-angle card with run action, plot, onset hint, and CSV', () => {
    const beta = {
      series: { et: new Float64Array([0, 3600]), value: new Float64Array([12, 8]), label: 'beta (deg)' },
      onsetDeg: 13.4,
      span: [0, 86400] as const,
    };
    const out = renderCard(betaCard(ctx(), beta));
    expect(out).toContain('data-testid="compute-beta"');
    expect(out).toContain('data-testid="beta-result"');
    expect(out).toContain('data-testid="beta-csv"');
    expect(out).toContain('data-testid="beta-onset"');
    // The interpretation hint carries the eclipse-onset threshold in degrees.
    expect(out).toContain('13.4 deg');
    // Empty state with no result is just the run action + hint, no result block.
    expect(renderCard(betaCard(ctx(), null))).not.toContain('data-testid="beta-result"');
  });

  it('renders the eclipse card with all four phase timelines and the per-day duration', () => {
    const phases = {
      umbra: [[100, 200]] as const,
      penumbra: [[90, 100]] as const,
      annular: [] as const,
      sunlit: [[200, 86400]] as const,
      span: [0, 86400] as const,
      shadowSecPerDay: 110,
    };
    const out = renderCard(eclipseCard(ctx(), phases));
    expect(out).toContain('data-testid="compute-eclipse"');
    expect(out).toContain('data-testid="eclipse-result"');
    for (const phase of ['umbra', 'penumbra', 'annular', 'sunlit']) {
      expect(out, `${phase} timeline`).toContain(`data-testid="eclipse-${phase}-timeline"`);
      expect(out, `${phase} csv`).toContain(`data-testid="eclipse-${phase}-csv"`);
    }
    // The per-day shadowed duration is reported in minutes (110 s -> 1.8 min).
    expect(out).toContain('data-testid="eclipse-duration"');
    expect(out).toContain('1.8 min/day');
  });

  it('renders the solar-intensity card with run action, plot, 0..1 hint, and CSV', () => {
    const series = { et: new Float64Array([0, 60]), value: new Float64Array([1, 0.4]), label: 'fraction' };
    const out = renderCard(solarIntensityCard(ctx(), series));
    expect(out).toContain('data-testid="compute-solar-intensity"');
    expect(out).toContain('data-testid="solar-intensity-result"');
    expect(out).toContain('data-testid="solar-intensity-csv"');
    expect(out).toContain('data-testid="solar-intensity-hint"');
    expect(out).toContain('1 = full sun, 0 = total umbra');
  });
});
