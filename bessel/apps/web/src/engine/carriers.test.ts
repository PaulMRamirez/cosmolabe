// The Wave 2B cross-tab carriers (analysis-UX section 5.2): OD covariance -> Conjunction
// supplied-covariance, and a conjunction event -> MCS avoidance burn. Both are explicit "send X to
// Y" actions writing to the scenario/store model (not bare tab jumps), so these assert the store
// shape each writes (and the loud failures), as pure reducers, without a worker or the scene.

import { describe, it, expect } from 'vitest';
import { screenAllVsAll } from '@bessel/conjunction';
import { createAppStore, type AppStore } from '../store/index.ts';
import {
  DEFAULT_AVOIDANCE_DV_KMS,
  odCovarianceInput,
  planAvoidanceBurn,
  sendOdCovarianceToConjunction,
} from './analysis-ops.ts';
import { ingestCatalog } from '../conjunction/ingest.ts';
import { SAMPLE_OEM } from '../panels/conjunction/sample-ingest.ts';
import type { ConjunctionCatalogRef } from './analysis-ops.ts';
import type { OdResult } from '../store/index.ts';

const odResult: OdResult = {
  estimate: [7000, 0, 0, 0, 7.5, 0],
  positionErrorKm: 0.01,
  velocityErrorKmS: 1e-5,
  residualRms: 0.9,
  iterations: 3,
  observationCount: 60,
  sigmaPositionKm: [0.05, 0.07, 0.09],
  label: 'OD',
};

// -- Carrier B.2: conjunction event -> MCS avoidance burn --------------------------------------

describe('planAvoidanceBurn (conjunction event -> MCS)', () => {
  function withSelectedEvent(): AppStore {
    const store = createAppStore();
    store.setState({
      conjunctionEvent: {
        index: 0,
        primaryId: 'A',
        secondaryId: 'B',
        tca: 100,
        pcFull: 1e-4,
        pcMax: 3e-4,
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
    return store;
  }

  it('appends one impulsive Maneuver seeded with the default along-track delta-v', () => {
    const store = withSelectedEvent();
    const before = store.getState().editableMcs.segments.length;

    planAvoidanceBurn(store);

    const segs = store.getState().editableMcs.segments;
    expect(segs).toHaveLength(before + 1);
    const appended = segs[segs.length - 1]!;
    expect(appended.kind).toBe('Maneuver');
    expect(appended.kind === 'Maneuver' && appended.dvKmS).toBeCloseTo(DEFAULT_AVOIDANCE_DV_KMS, 9);
  });

  it('leaves the prior segments intact (a pure append)', () => {
    const store = withSelectedEvent();
    const original = store.getState().editableMcs.segments;

    planAvoidanceBurn(store);

    expect(store.getState().editableMcs.segments.slice(0, original.length)).toEqual(original);
  });

  it('fails loud when no conjunction event is selected', () => {
    const store = createAppStore();
    expect(() => planAvoidanceBurn(store)).toThrow(/select a conjunction event/);
  });
});

// -- Carrier B.1: OD covariance -> Conjunction supplied-covariance ------------------------------

describe('odCovarianceInput (pure)', () => {
  it('builds a diagonal inertial covariance from the OD 1-sigma position', () => {
    const input = odCovarianceInput(odResult);
    expect(input.frame).toBe('inertial');
    // C = diag(sigma^2): the diagonal entries are the squared sigmas, off-diagonals zero.
    expect(input.matrix3).toEqual([0.05 ** 2, 0, 0, 0, 0.07 ** 2, 0, 0, 0, 0.09 ** 2]);
  });

  it('fails loud on a degenerate (non-positive) OD sigma', () => {
    const bad: OdResult = { ...odResult, sigmaPositionKm: [0.05, 0, 0.09] };
    expect(() => odCovarianceInput(bad)).toThrow(/must be positive/);
  });
});

describe('sendOdCovarianceToConjunction writes the supplied-covariance store shape', () => {
  // Ingest the covariance-less OEM sample, screen it synchronously, and seed the selected event,
  // so the carrier routes the OD covariance through setSuppliedCovariance and we can observe the
  // conjunctionSuppliedCovariances slice it writes (the same mechanism the manual form uses).
  function ingestedAndSelected(): { store: AppStore; ref: ConjunctionCatalogRef; objectId: string } {
    const store = createAppStore();
    const result = ingestCatalog('oem', SAMPLE_OEM);
    const ref: ConjunctionCatalogRef = { result, supplied: new Map() };
    const events = screenAllVsAll(result.catalog, { thresholdKm: 10 });
    expect(events.length).toBeGreaterThan(0);
    store.setState({
      screening: { status: 'done', done: 1, total: 1, epoch: result.epoch, events },
      selectedConjunctionEventId: 0,
      odResult,
    });
    return { store, ref, objectId: events[0]!.primaryId };
  }

  it('records the chosen object in conjunctionSuppliedCovariances', () => {
    const { store, ref, objectId } = ingestedAndSelected();
    expect(store.getState().conjunctionSuppliedCovariances).toEqual([]);

    sendOdCovarianceToConjunction(store, ref, objectId);

    expect(store.getState().conjunctionSuppliedCovariances).toContain(objectId);
    expect(ref.supplied.has(objectId)).toBe(true);
  });

  it('fails loud when there is no OD result to send', () => {
    const { store, ref, objectId } = ingestedAndSelected();
    store.setState({ odResult: null });
    expect(() => sendOdCovarianceToConjunction(store, ref, objectId)).toThrow(/run orbit determination/);
  });
});
