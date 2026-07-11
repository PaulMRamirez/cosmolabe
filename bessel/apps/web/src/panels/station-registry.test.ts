import { describe, it, expect } from 'vitest';
import { reduceStations, activeStation, StationRegistryError, type StationAction } from './station-registry.ts';
import type { GroundStation, ScenarioState } from '../store/app-state.ts';

// The ground-station registry reducer is a pure (slice, action) -> slice fold (analysis-UX Phase 2).
// These tests pin the add/update/remove/select transitions, the validation fail-loud, and that the
// input slice is never mutated. No UI, no SPICE.

const EMPTY: ScenarioState = {
  primarySpacecraft: null,
  spacecraftSource: null,
  secondaryObjects: [],
  stations: [],
  activeStationId: null,
  observationTarget: null,
  assetSet: [],
};

const station = (id: string, name = id): GroundStation => ({
  id,
  name,
  lonRad: -2,
  latRad: 0.6,
  altKm: 1,
  minElevationRad: 5 * (Math.PI / 180),
});

describe('reduceStations', () => {
  it('adds a station and makes it active', () => {
    const next = reduceStations(EMPTY, { kind: 'add', station: station('dss-14') });
    expect(next.stations).toHaveLength(1);
    expect(next.activeStationId).toBe('dss-14');
  });

  it('does not mutate the input slice', () => {
    reduceStations(EMPTY, { kind: 'add', station: station('a') });
    expect(EMPTY.stations).toHaveLength(0);
    expect(EMPTY.activeStationId).toBeNull();
  });

  it('rejects a duplicate id, an unknown update, and an unknown select', () => {
    const one = reduceStations(EMPTY, { kind: 'add', station: station('a') });
    expect(() => reduceStations(one, { kind: 'add', station: station('a') })).toThrow(StationRegistryError);
    expect(() => reduceStations(one, { kind: 'update', station: station('b') })).toThrow(StationRegistryError);
    expect(() => reduceStations(one, { kind: 'select', id: 'b' })).toThrow(StationRegistryError);
  });

  it('updates a station in place without changing the active id', () => {
    let s = reduceStations(EMPTY, { kind: 'add', station: station('a', 'A') });
    s = reduceStations(s, { kind: 'add', station: station('b', 'B') }); // active is now b
    s = reduceStations(s, { kind: 'update', station: { ...station('a'), name: 'Renamed' } });
    expect(s.stations.find((x) => x.id === 'a')?.name).toBe('Renamed');
    expect(s.activeStationId).toBe('b');
  });

  it('removes a station and clears the active id when it pointed at the removed one', () => {
    let s = reduceStations(EMPTY, { kind: 'add', station: station('a') }); // active a
    s = reduceStations(s, { kind: 'remove', id: 'a' });
    expect(s.stations).toHaveLength(0);
    expect(s.activeStationId).toBeNull();
  });

  it('keeps the active id when removing a different station', () => {
    let s = reduceStations(EMPTY, { kind: 'add', station: station('a') });
    s = reduceStations(s, { kind: 'add', station: station('b') }); // active b
    s = reduceStations(s, { kind: 'remove', id: 'a' });
    expect(s.activeStationId).toBe('b');
  });

  it('accepts a null select to clear the active station', () => {
    let s = reduceStations(EMPTY, { kind: 'add', station: station('a') });
    s = reduceStations(s, { kind: 'select', id: null });
    expect(s.activeStationId).toBeNull();
  });

  it('fails loud on out-of-range geodetic angles', () => {
    const badLon: StationAction = { kind: 'add', station: { ...station('a'), lonRad: 10 } };
    const badLat: StationAction = { kind: 'add', station: { ...station('a'), latRad: 10 } };
    expect(() => reduceStations(EMPTY, badLon)).toThrow(/longitude/);
    expect(() => reduceStations(EMPTY, badLat)).toThrow(/latitude/);
  });
});

describe('activeStation', () => {
  it('resolves the active station, or null when none is selected', () => {
    const s = reduceStations(EMPTY, { kind: 'add', station: station('a', 'A') });
    expect(activeStation(s)?.name).toBe('A');
    expect(activeStation(EMPTY)).toBeNull();
  });
});
