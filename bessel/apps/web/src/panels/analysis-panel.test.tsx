import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { LightingGeometryPanel } from './LightingGeometryPanel.tsx';
import { betaCard, eclipseCard, solarIntensityCard } from './lighting-cards.tsx';
import { AccessCommsPanel } from './AccessCommsPanel.tsx';
import { stationPassesCard, linkWorksheetCard, slewFeasibilityCard } from './access-comms-cards.tsx';
import { AccessConstraintForm } from './AccessConstraintForm.tsx';
import {
  DEFAULT_LINK_WORKSHEET,
  DEFAULT_SLEW_FEASIBILITY,
  DEFAULT_ACCESS_CONSTRAINTS,
} from '../engine/analysis-defaults.ts';
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
      [
        access(createAppStore()),
        ['access', 'in-fov', 'link', 'station-passes', 'link-worksheet', 'slew-feasibility'],
      ],
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

describe('Coverage panel: per-form Reset to defaults', () => {
  it('renders a Reset button on each config form, disabled while the form is at its defaults', () => {
    const out = coverage(createAppStore());
    // Both forms render their Reset affordance.
    expect(out).toContain('data-testid="coverage-constellation-reset"');
    expect(out).toContain('data-testid="coverage-grid-reset"');
    // A fresh panel sits at the module defaults, so each Reset is disabled (no-op).
    for (const id of ['coverage-constellation-reset', 'coverage-grid-reset']) {
      const close = out.indexOf(`data-testid="${id}"`);
      const open = out.lastIndexOf('<button', close);
      expect(out.slice(open, close)).toContain('disabled');
    }
  });
});

describe('Coverage panel: worker-ized sweep progress + cancel (Phase 3)', () => {
  it('shows the live progress readout and the cancel control while a sweep is running', () => {
    const store = createAppStore();
    store.setState({ coverageSweep: { status: 'running', done: 7, total: 162 } });
    const out = coverage(store, true);
    expect(out).toContain('data-testid="coverage-progress"');
    expect(out).toContain('7/162 cells');
    expect(out).toContain('data-testid="coverage-cancel"');
  });

  it('hides the progress + cancel controls when no sweep is running', () => {
    const out = coverage(createAppStore(), true);
    expect(out).not.toContain('data-testid="coverage-progress"');
    expect(out).not.toContain('data-testid="coverage-cancel"');
  });

  it('surfaces a loud sweep error', () => {
    const store = createAppStore();
    store.setState({ coverageSweep: { status: { error: 'no center body' }, done: 0, total: 0 } });
    const out = coverage(store, true);
    expect(out).toContain('data-testid="coverage-sweep-error"');
    expect(out).toContain('no center body');
  });
});

describe('Lighting & Geometry: selectable ground-track projection + station overlays (Phase 3)', () => {
  function seedGroundTrack(store: AppStore): void {
    store.setState({
      groundTrack: {
        et: new Float64Array([0, 1, 2]),
        lon: new Float64Array([0, 0.1, 0.2]),
        lat: new Float64Array([0, 0.1, 0.2]),
        label: 'Sub-spacecraft track',
      },
    });
  }

  it('exposes the projection select once a ground track exists', () => {
    const store = createAppStore();
    seedGroundTrack(store);
    const out = lighting(store, true);
    expect(out).toContain('data-testid="param-groundtrack-projection"');
    expect(out).toContain('Polar stereographic');
  });

  it('drapes scenario stations as overlay markers on the track', () => {
    const store = createAppStore();
    seedGroundTrack(store);
    store.setState((s) => ({
      scenario: {
        ...s.scenario,
        stations: [{ id: 'mad', name: 'Madrid', lonRad: -0.06, latRad: 0.7, altKm: 0.8 }],
      },
    }));
    expect(lighting(store, true)).toContain('data-testid="groundtrack-station-overlay"');
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
    // [ux-p2-conjunction] the per-event result always offers the CDM export.
    expect(out).toContain('data-testid="export-cdm"');
  });

  it('reflects the first-class active selection on the event row (aria-selected)', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: { format: 'cdm', objectCount: 2, covarianceCount: 2, ids: ['A', 'B'], note: '' },
      screening: {
        status: 'done',
        done: 1,
        total: 1,
        epoch: 0,
        events: [{ primaryId: 'A', secondaryId: 'B', tca: 60, missKm: 1, relSpeedKmS: 0.5, pc: 1e-5 }],
      },
      selectedConjunctionEventId: 0,
    });
    const out = conjunction(store, true);
    expect(out).toContain('aria-selected="true"');
    expect(out).toContain('bessel-event-row-active');
  });

  it('shows the covariance-input form (cov-frame + param-cov-sigma) when the pair carries no covariance', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: { format: 'tle', objectCount: 2, covarianceCount: 0, ids: ['A', 'B'], note: '' },
      selectedConjunctionEventId: 0,
      conjunctionEvent: {
        index: 0,
        primaryId: 'A',
        secondaryId: 'B',
        tca: 60,
        pcFull: null,
        pcMax: 2.2e-4,
        missXKm: 1.5,
        missYKm: 0,
        missKm: 1.5,
        radiusKm: 0.01,
        relSpeedKmS: 0.12,
        hasCovariance: false,
        ellipses: [],
        extentKm: 2,
      },
    });
    const out = conjunction(store, true);
    expect(out).toContain('data-testid="covariance-input"');
    expect(out).toContain('data-testid="cov-frame"');
    expect(out).toContain('data-testid="param-cov-sigma"');
    expect(out).toContain('data-testid="export-cdm"');
  });

  it('hides the covariance-input form once the event carries a (supplied or ingested) covariance', () => {
    const store = createAppStore();
    store.setState({
      conjunctionIngest: { format: 'cdm', objectCount: 2, covarianceCount: 2, ids: ['A', 'B'], note: '' },
      conjunctionEvent: {
        index: 0,
        primaryId: 'A',
        secondaryId: 'B',
        tca: 60,
        pcFull: 1.2e-4,
        pcMax: 3.4e-4,
        missXKm: 1.5,
        missYKm: 0.5,
        missKm: 1.58,
        radiusKm: 0.01,
        relSpeedKmS: 0.12,
        hasCovariance: true,
        ellipses: [{ sigma: 1, semiMajorKm: 0.2, semiMinorKm: 0.1, angleRad: 0 }],
        extentKm: 2,
      },
    });
    const out = conjunction(store, true);
    expect(out).not.toContain('data-testid="covariance-input"');
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

  it('disables the az/el mask (no station) and terrain LOS (no terrain source) toggles by default', () => {
    const out = access(createAppStore());
    expect(out).toContain('data-testid="constraint-azelmask"');
    expect(out).toContain('data-testid="constraint-terrainlos"');
    // Without an active station the az/el mask is disabled with a select-a-station hint.
    expect(out).toContain('select a ground station');
    // The terrain-source selector is present (Phase 3 ungate); with the default 'none' source the
    // terrain LOS toggle is disabled with a choose-a-source hint rather than gated to a later phase.
    expect(out).toContain('data-testid="param-terrain-source"');
    expect(out).toContain('choose a terrain source');
    const disabledCount = (out.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(2);
  });

  it('UNGATES the terrain LOS toggle once a terrain source is chosen (Phase 3)', () => {
    // Render the constraint form directly with the sample-ridge source selected: the toggle is live
    // (no disabled attribute) and the sample-data note is shown.
    const withSource = renderToStaticMarkup(
      createElement(AccessConstraintForm, {
        value: { ...DEFAULT_ACCESS_CONSTRAINTS, terrainSource: 'sample-ridge', terrainLosEnabled: true },
        onChange: () => undefined,
      }),
    );
    expect(withSource).toContain('data-testid="terrain-sample-note"');
    expect(withSource).toContain('Sample data');
    // The terrain toggle is not disabled (no disabled="" attribute on its input) once a source is set.
    expect(withSource).toMatch(/data-testid="constraint-terrainlos"(?![^>]*disabled)/);
  });

  it('UNGATES the az/el mask toggle once a ground station is active', () => {
    const store = createAppStore();
    store.setState((s) => ({
      scenario: {
        ...s.scenario,
        stations: [{ id: 'dss-14', name: 'Goldstone', lonRad: -2, latRad: 0.6, altKm: 1, minElevationRad: 0.17 }],
        activeStationId: 'dss-14',
      },
    }));
    const out = access(store, true);
    // The az/el mask toggle now names the active station and is no longer disabled-gated.
    expect(out).toContain('Az/el horizon mask at Goldstone');
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
  trayFull: false,
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

// The Access & Comms Phase-2 cards (station passes, link worksheet, slew feasibility). The cards
// call useStore, so they are rendered through a component (deferring the hook into a render pass)
// rather than invoked eagerly; the accordion renders them the same way in the panel.
const renderHookCard = (render: () => ReactNode): string =>
  renderToStaticMarkup(createElement(() => createElement('div', null, render())));

describe('Access & Comms Phase-2 cards surface passes / worksheet / slew feasibility', () => {
  const passesSlice = {
    stationName: 'Goldstone',
    spacecraft: 'Probe',
    span: [0, 86400] as const,
    passes: [
      { id: 'pass-0', rise: 100, set: 700, maxElevationEpoch: 400, maxElevationRad: 1, maxElevationRangeKm: 800, worstElevationRad: 0.18, worstElevationRangeKm: 2400 },
      { id: 'pass-1', rise: 6000, set: 6600, maxElevationEpoch: 6300, maxElevationRad: 0.9, maxElevationRangeKm: 900, worstElevationRad: 0.18, worstElevationRangeKm: 2500 },
    ],
    fom: { percentCoverage: 0.1, accessCount: 2, maxGapSec: 5300 },
    label: 'Probe over Goldstone',
  };

  it('gates the station-passes card on an active station, then renders selectable pass rows', () => {
    const gated = renderHookCard(() =>
      stationPassesCard({ engine: null, store: createAppStore(), runStatus: undefined, span: { spanSec: 86400, stepSec: 60 } }),
    );
    expect(gated).toContain('data-testid="compute-station-passes"');
    expect(gated).toContain('data-testid="station-passes-gate"');

    const store = createAppStore();
    store.setState({
      scenario: { ...store.getState().scenario, stations: [{ id: 's', name: 'Goldstone', lonRad: -2, latRad: 0.6, altKm: 1 }], activeStationId: 's' },
      stationPasses: passesSlice,
    });
    const out = renderHookCard(() =>
      stationPassesCard({ engine: null, store, runStatus: undefined, span: { spanSec: 86400, stepSec: 60 } }),
    );
    expect(out).toContain('data-testid="station-passes"');
    expect(out).toContain('data-testid="station-passes-table"');
    expect(out).toContain('data-testid="station-pass-pass-0"');
    expect(out).toContain('data-testid="select-pass-pass-0"');
    // Each row carries a "Pair with next" toggle that drives the slew binding (F40); the last row's
    // toggle is disabled because a pair is two consecutive passes.
    expect(out).toContain('data-testid="slew-pair-0"');
    expect(out).toContain('data-testid="slew-pair-1"');
    expect(out).toContain('Pair with next');
  });

  it('renders the link worksheet with the MODCOD select, margin readout, threshold chart, and CSV', () => {
    const store = createAppStore();
    store.setState({
      selectedPassId: 'pass-0',
      linkWorksheet: {
        passId: 'pass-0',
        modcodName: 'ccsds-conv-r1_2',
        requiredEbN0Db: 4.4,
        worstCase: { caseLabel: 'Worst-case elevation', elevationDeg: 10, rangeKm: 2400, lines: [{ id: 'margin', label: 'Margin', value: 2.1, unit: 'dB' }], ebN0Db: 6.5, requiredEbN0Db: 4.4, marginDb: 2.1 },
        nominal: { caseLabel: 'Nominal (max) elevation', elevationDeg: 57, rangeKm: 800, lines: [{ id: 'margin', label: 'Margin', value: 12.3, unit: 'dB' }], ebN0Db: 16.7, requiredEbN0Db: 4.4, marginDb: 12.3 },
        marginSeries: { et: new Float64Array([0, 1, 2]), value: new Float64Array([2.1, 7, 12.3]), label: 'margin' },
        note: '',
        label: 'Link worksheet over Goldstone pass',
      },
    });
    const out = renderHookCard(() =>
      linkWorksheetCard({ engine: null, store, runStatus: undefined, worksheetParams: DEFAULT_LINK_WORKSHEET, setWorksheetParams: () => undefined }),
    );
    expect(out).toContain('data-testid="param-modcod"');
    expect(out).toContain('data-testid="compute-link-worksheet"');
    expect(out).toContain('data-testid="link-worksheet"');
    expect(out).toContain('data-testid="link-margin"');
    expect(out).toContain('data-testid="link-worksheet-worst"');
    expect(out).toContain('data-testid="link-worksheet-nominal"');
    expect(out).toContain('data-testid="link-margin-chart"');
    expect(out).toContain('data-testid="link-margin-chart-threshold"');
    expect(out).toContain('data-testid="link-worksheet-csv"');
    // The bound pass shows as a clearable chip (F33): the ✕ clears the binding via the existing handler.
    expect(out).toContain('data-testid="link-worksheet-binding-chip"');
    expect(out).toContain('data-testid="link-worksheet-binding-chip-clear"');
  });

  it('renders the slew-feasibility card with the fits verdict when a pair is selected', () => {
    const gated = renderHookCard(() =>
      slewFeasibilityCard({ engine: null, store: createAppStore(), runStatus: undefined, slewParams: DEFAULT_SLEW_FEASIBILITY, setSlewParams: () => undefined }),
    );
    // No pair selected: the run action is present but the binding hint asks for two passes.
    expect(gated).toContain('data-testid="compute-slew-feasibility"');
    expect(gated).toContain('data-testid="slew-feasibility-binding"');

    const store = createAppStore();
    store.setState({
      selectedWindowPair: ['pass-0', 'pass-1'],
      slewFeasibility: { fromPassId: 'pass-0', toPassId: 'pass-1', mode: 'targetTrack', slewAngleDeg: 12, slewDurationSec: 30, gapSec: 5300, slackSec: 5270, fits: true, label: 'Probe slew' },
    });
    const out = renderHookCard(() =>
      slewFeasibilityCard({ engine: null, store, runStatus: undefined, slewParams: DEFAULT_SLEW_FEASIBILITY, setSlewParams: () => undefined }),
    );
    expect(out).toContain('data-testid="slew-feasibility"');
    expect(out).toContain('data-testid="slew-fits"');
    expect(out).toContain('Slew FITS');
    // The bound pair shows as a clearable chip (F33).
    expect(out).toContain('data-testid="slew-feasibility-binding-chip"');
    expect(out).toContain('data-testid="slew-feasibility-binding-chip-clear"');
  });
});
