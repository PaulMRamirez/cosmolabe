// The ground-station registry reducer (analysis-UX Phase 2, comms-engineer + observation-planner
// journeys). Stations are first-class shared-context role slots: the access/comms/observation cards
// read the ACTIVE station by role. This pure reducer drives scenario.stations + activeStationId from
// the context-bar registry control. No SPICE, no DOM: a plain (slice, action) -> slice fold, so the
// add/edit/select/remove transitions are unit-tested directly. Fails loud on a malformed station
// (the context-bar form validates UI units; this guards the engine-unit invariants).

import type { GroundStation, ScenarioState } from '../store/app-state.ts';

/** A located, typed error for a station the registry cannot accept (fail loudly). */
export class StationRegistryError extends Error {
  override readonly name = 'StationRegistryError';
  constructor(message: string) {
    super(`station-registry: ${message}`);
  }
}

/** The mutating actions the context-bar registry control dispatches against the station slice. */
export type StationAction =
  | { readonly kind: 'add'; readonly station: GroundStation }
  | { readonly kind: 'update'; readonly station: GroundStation }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'select'; readonly id: string | null };

/** Validate a station's engine-unit invariants, failing loud rather than storing a bad site. */
function validateStation(s: GroundStation): GroundStation {
  if (!s.id) throw new StationRegistryError('a station needs a non-empty id');
  if (!s.name) throw new StationRegistryError(`station ${s.id} needs a non-empty name`);
  if (!Number.isFinite(s.lonRad) || Math.abs(s.lonRad) > Math.PI + 1e-9) {
    throw new StationRegistryError(`station ${s.id} longitude must be a radian in [-pi, pi], got ${s.lonRad}`);
  }
  if (!Number.isFinite(s.latRad) || Math.abs(s.latRad) > Math.PI / 2 + 1e-9) {
    throw new StationRegistryError(`station ${s.id} latitude must be a radian in [-pi/2, pi/2], got ${s.latRad}`);
  }
  if (!Number.isFinite(s.altKm)) {
    throw new StationRegistryError(`station ${s.id} altitude must be finite km, got ${s.altKm}`);
  }
  if (s.minElevationRad !== undefined && (!Number.isFinite(s.minElevationRad) || s.minElevationRad < 0)) {
    throw new StationRegistryError(
      `station ${s.id} min elevation must be a non-negative radian, got ${s.minElevationRad}`,
    );
  }
  return s;
}

/**
 * Fold a station action into the scenario slice. Add appends (rejecting a duplicate id) and makes
 * the new station active; update replaces by id (rejecting an unknown id); remove drops by id and
 * clears the active id when it pointed at the removed station; select sets the active id (rejecting
 * an id not in the registry, but accepting null to clear). Returns a fresh slice; the input is never
 * mutated. Fails loud on a malformed station or an unknown id.
 */
export function reduceStations(scenario: ScenarioState, action: StationAction): ScenarioState {
  switch (action.kind) {
    case 'add': {
      const station = validateStation(action.station);
      if (scenario.stations.some((s) => s.id === station.id)) {
        throw new StationRegistryError(`a station with id "${station.id}" already exists`);
      }
      return { ...scenario, stations: [...scenario.stations, station], activeStationId: station.id };
    }
    case 'update': {
      const station = validateStation(action.station);
      if (!scenario.stations.some((s) => s.id === station.id)) {
        throw new StationRegistryError(`no station with id "${station.id}" to update`);
      }
      return {
        ...scenario,
        stations: scenario.stations.map((s) => (s.id === station.id ? station : s)),
      };
    }
    case 'remove': {
      const stations = scenario.stations.filter((s) => s.id !== action.id);
      const activeStationId = scenario.activeStationId === action.id ? null : scenario.activeStationId;
      return { ...scenario, stations, activeStationId };
    }
    case 'select': {
      if (action.id !== null && !scenario.stations.some((s) => s.id === action.id)) {
        throw new StationRegistryError(`cannot select unknown station "${action.id}"`);
      }
      return { ...scenario, activeStationId: action.id };
    }
  }
}

/** The active station resolved from the slice, or null when none is selected. */
export function activeStation(scenario: ScenarioState): GroundStation | null {
  if (scenario.activeStationId === null) return null;
  return scenario.stations.find((s) => s.id === scenario.activeStationId) ?? null;
}
