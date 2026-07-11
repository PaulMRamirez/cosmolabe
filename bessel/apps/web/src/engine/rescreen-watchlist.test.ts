// [ux-p3-conjunction] The store-facing rescreen + watchlist ops: rescreenAfterManeuver applies the
// solved avoidance burn to the selected event's primary, re-screens against the ingested catalog, and
// writes the before/after comparison + updates a watched row; watchSelectedEvent seeds a row. Driven
// through a real AppStore + a ConjunctionCatalogRef built from a hand-made near-miss catalog (SPICE-
// free, synchronous, deterministic).

import { describe, it, expect } from 'vitest';
import { screenAllVsAll, type SampledEphemeris } from '@bessel/conjunction';
import { createAppStore, type AppStore } from '../store/index.ts';
import { rescreenAfterManeuver, watchSelectedEvent, type ConjunctionCatalogRef } from './analysis-ops.ts';
import type { IngestResult } from '../conjunction/ingest.ts';

function ephemeris(id: string, positions: readonly (readonly [number, number, number])[]): SampledEphemeris {
  const et = [0, 25, 50, 75, 100];
  const n = et.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  positions.forEach((p, i) => {
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
  });
  for (let i = 0; i < n; i++) {
    const j = i < n - 1 ? i : i - 1;
    const dt = et[j + 1]! - et[j]!;
    for (let c = 0; c < 3; c++) vel[i * 3 + c] = (pos[(j + 1) * 3 + c]! - pos[j * 3 + c]!) / dt;
  }
  return { id, et: Float64Array.from(et), pos, vel, radiusKm: 0.05, sigmaKm: 0.5 };
}

const PRIMARY = ephemeris('PRIMARY', [
  [-100, 0, 0],
  [-50, 0, 0],
  [0, 0, 0],
  [50, 0, 0],
  [100, 0, 0],
]);
// A secondary crossing the primary's mid-point along +Y at t = 50 (a real near miss there), so an
// along-track shift of the primary opens the miss rather than just changing the encounter timing.
const SECONDARY = ephemeris('SECONDARY', [
  [0, -100, 0],
  [0, -50, 0],
  [0, 0.2, 0],
  [0, 50, 0],
  [0, 100, 0],
]);

function seeded(): { store: AppStore; ref: ConjunctionCatalogRef } {
  const catalog = [PRIMARY, SECONDARY];
  const result = {
    catalog,
    covariances: new Map(),
    format: 'oem',
    epoch: 0,
    note: 'test',
  } as unknown as IngestResult;
  const ref: ConjunctionCatalogRef = { result, supplied: new Map() };
  const events = screenAllVsAll(catalog, { thresholdKm: 10 });
  expect(events.length).toBeGreaterThan(0);
  const store = createAppStore();
  const ev = events[0]!;
  store.setState({
    screening: { status: 'done', done: 1, total: 1, epoch: 0, events },
    selectedConjunctionEventId: 0,
    conjunctionEvent: {
      index: 0,
      primaryId: ev.primaryId,
      secondaryId: ev.secondaryId,
      tca: ev.tca,
      pcFull: null,
      pcMax: 1e-3,
      missXKm: ev.missKm,
      missYKm: 0,
      missKm: ev.missKm,
      radiusKm: 0.1,
      relSpeedKmS: ev.relSpeedKmS,
      hasCovariance: false,
      ellipses: [],
      extentKm: 1,
    },
    // A solved MCS along-track delta-v large enough to clear the encounter.
    mcsResult: {
      finalRadiusKm: 7000,
      finalSpeedKmS: 7.5,
      finalEpoch: 0,
      altitude: { et: new Float64Array(), value: new Float64Array(), label: '' },
      converged: true,
      iterations: 3,
      goals: [],
      residualHistory: [],
      solvedDvKmS: 5,
      label: 'mcs',
    },
  });
  return { store, ref };
}

describe('rescreenAfterManeuver', () => {
  it('writes a before/after comparison that shows the risk reduced', () => {
    const { store, ref } = seeded();
    rescreenAfterManeuver(store, ref);
    const cmp = store.getState().rescreen!;
    expect(cmp).not.toBeNull();
    expect(cmp.primaryId).toBe('PRIMARY');
    expect(cmp.reduced).toBe(true);
  });

  it('updates a watched pair row to the post-maneuver values', () => {
    const { store, ref } = seeded();
    watchSelectedEvent(store);
    expect(store.getState().watchlist.rows).toHaveLength(1);
    rescreenAfterManeuver(store, ref);
    const row = store.getState().watchlist.rows[0]!;
    // The re-screen folded the after Pc/miss into the row (trend derived from the prior seed).
    expect(['fell', 'unchanged', 'rose']).toContain(row.trend);
  });

  it('fails loud when no event is selected', () => {
    const { ref } = seeded();
    const store = createAppStore();
    expect(() => rescreenAfterManeuver(store, ref)).toThrow(/select a conjunction event/);
  });
});

describe('watchSelectedEvent', () => {
  it('seeds a tracked row from the selected event, and fails loud without one', () => {
    const { store } = seeded();
    watchSelectedEvent(store);
    expect(store.getState().watchlist.rows[0]).toMatchObject({ primaryId: 'PRIMARY', trend: 'new' });
    expect(() => watchSelectedEvent(createAppStore())).toThrow(/select a conjunction event/);
  });
});
