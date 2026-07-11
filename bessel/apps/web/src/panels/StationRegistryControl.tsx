// The ground-station registry control in the SHARED analysis context bar (analysis-UX Phase 2).
// Stations are first-class shared-context role slots: this control adds/edits/selects ground stations
// (name, lon, lat, alt, min-elevation mask) writing scenario.stations + activeStationId through the
// engine's reduceStations dispatch, and the access/comms cards read the ACTIVE station by role. A
// station select picks the active one; an inline form adds a new station. UI units: degrees for the
// geodetic site + the mask, converted to radians at dispatch. Presentational + the engine dispatch.

import { useState } from 'react';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore, type GroundStation } from '../store/index.ts';
import { DEG2RAD, RAD2DEG } from '../angles.ts';

export interface StationRegistryControlProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  /**
   * [ux-f30] Overwrite an existing station by id (the Edit-into-draft update flow). The parent
   * wires this to engine.updateStation(station), which dispatches the reducer's update action
   * (replace-by-id). Optional: when absent the per-row Edit controls are not rendered.
   */
  readonly onUpdateStation?: (station: GroundStation) => void;
}

/** The new-station draft the add form edits, in UI units (degrees). */
interface StationDraft {
  readonly name: string;
  readonly lonDeg: string;
  readonly latDeg: string;
  readonly altKm: string;
  readonly minElevationDeg: string;
}

const EMPTY_DRAFT: StationDraft = { name: '', lonDeg: '', latDeg: '', altKm: '0', minElevationDeg: '5' };

/** A stable station id from its name (slug + a short disambiguating suffix from the registry size). */
function stationId(name: string, count: number): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'station'}-${count + 1}`;
}

export function StationRegistryControl({ engine, store, onUpdateStation }: StationRegistryControlProps): JSX.Element {
  const stations = useStore(store, (s) => s.scenario.stations);
  const activeStationId = useStore(store, (s) => s.scenario.activeStationId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<StationDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  // [ux-f30] The id being edited; non-null switches the draft form into update mode (overwrite by id).
  const [editingId, setEditingId] = useState<string | null>(null);

  const set = (patch: Partial<StationDraft>): void => setDraft((d) => ({ ...d, ...patch }));

  /** [ux-f30] Load a station's current values back into the draft form and switch to update mode. */
  const editStation = (s: GroundStation): void => {
    setDraft({
      name: s.name,
      lonDeg: String(s.lonRad * RAD2DEG),
      latDeg: String(s.latRad * RAD2DEG),
      altKm: String(s.altKm),
      minElevationDeg: String((s.minElevationRad ?? 0) * RAD2DEG),
    });
    setEditingId(s.id);
    setAdding(true);
    setError(null);
  };

  const submit = (): void => {
    const lon = Number(draft.lonDeg);
    const lat = Number(draft.latDeg);
    const alt = Number(draft.altKm);
    const minEl = Number(draft.minElevationDeg);
    if (!draft.name.trim()) {
      setError('a station needs a name');
      return;
    }
    if (![lon, lat, alt, minEl].every(Number.isFinite)) {
      setError('lon, lat, alt, and min elevation must be numbers');
      return;
    }
    const station: GroundStation = {
      // In update mode keep the existing id (overwrite by id); in add mode mint a fresh one.
      id: editingId ?? stationId(draft.name, stations.length),
      name: draft.name.trim(),
      lonRad: lon * DEG2RAD,
      latRad: lat * DEG2RAD,
      altKm: alt,
      minElevationRad: minEl * DEG2RAD,
    };
    try {
      if (editingId) {
        onUpdateStation?.(station);
      } else {
        engine?.addStation(station);
      }
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      setEditingId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="bessel-station-registry" role="group" aria-label="Ground stations" data-testid="station-registry">
      <label>
        Station
        <select
          value={activeStationId ?? ''}
          data-testid="station-select"
          onChange={(ev) => engine?.selectStation(ev.target.value || null)}
        >
          <option value="">(none)</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {activeStationId && onUpdateStation ? (
        <button
          type="button"
          data-testid={`station-edit-${activeStationId}`}
          aria-label="Edit the active station"
          onClick={() => {
            const s = stations.find((st) => st.id === activeStationId);
            if (s) editStation(s);
          }}
        >
          Edit
        </button>
      ) : null}
      {activeStationId ? (
        <button
          type="button"
          data-testid="station-remove"
          aria-label="Remove the active station"
          onClick={() => engine?.removeStation(activeStationId)}
        >
          Remove
        </button>
      ) : null}
      <button
        type="button"
        aria-pressed={adding}
        data-testid="station-add-toggle"
        onClick={() => {
          setAdding((v) => !v);
          setDraft(EMPTY_DRAFT);
          setEditingId(null);
          setError(null);
        }}
      >
        {adding ? 'Cancel' : 'Add station'}
      </button>
      {adding ? (
        <div className="bessel-station-form" data-testid="station-form">
          <label>
            Name
            <input
              type="text"
              value={draft.name}
              data-testid="station-name"
              onChange={(ev) => set({ name: ev.target.value })}
            />
          </label>
          <label>
            Lon (deg)
            <input
              type="number"
              step="any"
              value={draft.lonDeg}
              data-testid="station-lon"
              onChange={(ev) => set({ lonDeg: ev.target.value })}
            />
          </label>
          <label>
            Lat (deg)
            <input
              type="number"
              step="any"
              value={draft.latDeg}
              data-testid="station-lat"
              onChange={(ev) => set({ latDeg: ev.target.value })}
            />
          </label>
          <label>
            Alt (km)
            <input
              type="number"
              step="any"
              value={draft.altKm}
              data-testid="station-alt"
              onChange={(ev) => set({ altKm: ev.target.value })}
            />
          </label>
          <label>
            Min elevation (deg)
            <input
              type="number"
              step="any"
              value={draft.minElevationDeg}
              data-testid="station-minel"
              onChange={(ev) => set({ minElevationDeg: ev.target.value })}
            />
          </label>
          {editingId ? (
            <button type="button" data-testid="station-update" onClick={submit}>
              Update station
            </button>
          ) : (
            <button type="button" data-testid="station-save" onClick={submit}>
              Save station
            </button>
          )}
          {error ? (
            <p className="bessel-loader-hint" role="alert" data-testid="station-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {activeStationId ? (
        <p className="bessel-loader-hint" data-testid="station-active-note">
          Active: {stations.find((s) => s.id === activeStationId)?.name} at{' '}
          {((stations.find((s) => s.id === activeStationId)?.minElevationRad ?? 0) * RAD2DEG).toFixed(1)} deg mask.
        </p>
      ) : null}
    </div>
  );
}
