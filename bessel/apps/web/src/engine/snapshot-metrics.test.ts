// The generalized compare-snapshot model (analysis-UX Wave 2B): EVERY result block across the six
// domain panels can be kept as a typed variant snapshot. These assert the builder maps each domain's
// seeded result to its decision metrics (and to the right grouping domain), and that an absent result
// yields null (so Keep is a no-op). One case per domain covers the "a snapshot from each domain" goal.

import { describe, it, expect } from 'vitest';
import { createAppStore } from '../store/index.ts';
import {
  buildSnapshotMetrics,
  buildSnapshotLabel,
  kindDomain,
  type SnapshotKind,
} from './snapshot-metrics.ts';

const series = (values: number[]) => ({
  et: Float64Array.from(values.map((_, i) => i)),
  value: Float64Array.from(values),
  label: 'series',
});

describe('snapshot kind -> domain grouping', () => {
  it('maps every kind to its compare-tray domain', () => {
    const cases: [SnapshotKind, string][] = [
      ['lighting-beta', 'lighting'],
      ['lighting-eclipse', 'lighting'],
      ['lighting-solar', 'lighting'],
      ['access', 'access'],
      ['access-passes', 'access'],
      ['access-slew', 'access'],
      ['access-worksheet', 'link'],
      ['conjunction', 'conjunction'],
      ['conjunction-event', 'conjunction'],
      ['coverage', 'coverage'],
      ['orbit-porkchop', 'orbit'],
      ['orbit-mcs', 'orbit'],
      ['link', 'link'],
    ];
    for (const [kind, domain] of cases) expect(kindDomain(kind), kind).toBe(domain);
  });
});

describe('buildSnapshotLabel identifies a coverage snapshot by its Walker design', () => {
  it('labels a coverage snapshot Walker T/P/perPlane and captures the design in metrics', () => {
    const store = createAppStore();
    store.setState({
      designedConstellation: { assetIds: ['a', 'b'], totalSats: 24, planes: 3, perPlane: 8 },
      coverageGrid: {
        areaWeightedPercentCoverage: 0.8,
        cellCount: 9,
        assetCount: 24,
        metric: { id: 'revisit', label: 'Revisit (min)', unit: 'min', nFoldK: 1 },
        summary: null,
        // The grid arrays the panel renders are not read by the metric builder.
      } as never,
    });
    const s = store.getState();
    expect(buildSnapshotLabel('coverage', s, 2)).toBe('Walker 24/3/8');
    const m = buildSnapshotMetrics('coverage', s);
    expect(m?.Walker).toBe('24/3/8');
    expect(m?.metric).toBe('Revisit (min)');
  });

  it('falls back to the sequenced default label when no design is present', () => {
    const s = createAppStore().getState();
    expect(buildSnapshotLabel('coverage', s, 5)).toBe('coverage 5');
    expect(buildSnapshotLabel('lighting-beta', s, 3)).toBe('lighting-beta 3');
  });
});

describe('buildSnapshotMetrics is null until the result is present', () => {
  it('returns null for every kind on a fresh store', () => {
    const s = createAppStore().getState();
    const kinds: SnapshotKind[] = [
      'lighting-beta',
      'lighting-eclipse',
      'lighting-solar',
      'access',
      'access-passes',
      'access-worksheet',
      'access-slew',
      'conjunction',
      'conjunction-event',
      'coverage',
      'orbit-porkchop',
      'orbit-mcs',
      'link',
    ];
    for (const k of kinds) expect(buildSnapshotMetrics(k, s), k).toBeNull();
  });
});

describe('buildSnapshotMetrics builds decision metrics from a seeded result (one per domain)', () => {
  it('lighting (beta)', () => {
    const store = createAppStore();
    store.setState({ betaSeries: { series: series([12, 8, 30]), onsetDeg: 13.4, span: [0, 86400] } });
    const m = buildSnapshotMetrics('lighting-beta', store.getState());
    expect(m).toEqual({ 'beta min (deg)': '8.0', 'beta max (deg)': '30.0', 'eclipse-onset (deg)': '13.4' });
  });

  it('access (constraint stack)', () => {
    const store = createAppStore();
    store.setState({
      accessResult: {
        window: [],
        span: [0, 86400],
        fom: { percentCoverage: 0.5, accessCount: 4, maxGapSec: 600 },
        label: 'access',
      },
    });
    const m = buildSnapshotMetrics('access', store.getState());
    expect(m).toEqual({ 'coverage %': '50.0', passes: 4, 'max gap (min)': '10.0' });
  });

  it('conjunction (per-event Pc)', () => {
    const store = createAppStore();
    store.setState({
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
    const m = buildSnapshotMetrics('conjunction-event', store.getState());
    expect(m).toMatchObject({ Pc: '1.20e-4', 'max Pc': '3.40e-4', 'miss (km)': '0.300' });
  });

  it('coverage (FOM summary)', () => {
    const store = createAppStore();
    store.setState({
      coverageGrid: {
        cellCount: 200,
        areaWeightedPercentCoverage: 0.83,
        label: 'coverage',
        assetCount: 24,
        metric: null,
        summary: {
          cellCount: 200,
          areaWeightedPercentCoverage: 0.83,
          minPercentCoverage: 0.1,
          meanPercentCoverage: 0.5,
          maxPercentCoverage: 0.99,
          worstRevisitMaxSec: 1800,
          worstResponseTimeSec: null,
          nFoldCellFraction: 0.2,
          nFoldK: 2,
        },
      },
    });
    const m = buildSnapshotMetrics('coverage', store.getState());
    expect(m).toEqual({
      'area-weighted %': '83.0',
      cells: 200,
      assets: 24,
      'worst revisit (min)': '30.0',
    });
  });

  it('orbit (MCS solved dv)', () => {
    const store = createAppStore();
    store.setState({
      mcsResult: {
        finalRadiusKm: 7200,
        finalSpeedKmS: 7.4,
        finalEpoch: 0,
        altitude: series([500, 800]),
        converged: true,
        iterations: 3,
        goals: [],
        residualHistory: [],
        solvedDvKmS: 0.123,
        label: 'mcs',
      },
    });
    const m = buildSnapshotMetrics('orbit-mcs', store.getState());
    expect(m).toMatchObject({ 'final radius (km)': '7200.0', 'solved dv (km/s)': '0.1230', converged: 'yes' });
  });

  it('link (downlink Eb/N0)', () => {
    const store = createAppStore();
    store.setState({ linkSeries: series([5, 9, 7]) });
    const m = buildSnapshotMetrics('link', store.getState());
    expect(m).toEqual({ 'min Eb/N0 (dB)': '5.0', 'mean Eb/N0 (dB)': '7.0' });
  });
});
