// The single typed state tree for the web viewer. It collapses the ~25 useState
// values the monolithic viewer carried (plus the playing/rate/instruments/track
// mirror refs) into one object that both React (via useStore) and the imperative
// BesselEngine (via getState/setState) share.

import type { CatalogEntry, Readouts, VisualizationSettings } from '@bessel/ui';
import { DEFAULT_OBJECT_ENTRIES } from '../catalog-load.ts';
import { createStore, type Store } from './create-store.ts';

export interface AppState {
  // Lifecycle.
  status: string;
  ready: boolean;
  // Playback and time.
  playing: boolean;
  rate: number;
  et: number;
  bounds: readonly [number, number];
  epochLabel: string;
  // Camera and selection.
  focus: string;
  selection: readonly string[];
  track: boolean;
  // Instruments.
  instruments: boolean;
  footprintPoints: number;
  fovOk: boolean;
  // Layers and per-object visibility.
  settings: VisualizationSettings;
  visibility: Readonly<Record<string, boolean>>;
  // Readouts and chrome.
  readouts: Readouts;
  helpOpen: boolean;
  recording: boolean;
  // Theme: persisted to the document via data-theme.
  theme: 'dark' | 'light';
  // Catalog: the object list (catalog-driven) and load status.
  objects: readonly CatalogEntry[];
  loadedName: string | null;
  loadError: string | null;
  // Measurement: distance between the first two selected objects.
  measurement: Measurement | null;
}

export interface Measurement {
  readonly from: string;
  readonly to: string;
  readonly distanceKm: number;
}

export const initialAppState: AppState = {
  status: 'Initializing',
  ready: false,
  playing: false,
  rate: 86400,
  et: 0,
  bounds: [0, 1],
  epochLabel: '',
  focus: 'Saturn',
  selection: [],
  track: false,
  instruments: false,
  footprintPoints: 0,
  fovOk: false,
  settings: {
    trajectory: true,
    labels: true,
    fov: true,
    footprint: true,
    axes: true,
    stars: true,
    atmosphere: false,
    shadows: false,
  },
  visibility: {},
  readouts: {
    rangeKm: null,
    phaseDeg: null,
    incidenceDeg: null,
    emissionDeg: null,
  },
  helpOpen: false,
  recording: false,
  theme: 'dark',
  objects: DEFAULT_OBJECT_ENTRIES,
  loadedName: null,
  loadError: null,
  measurement: null,
};

export type AppStore = Store<AppState>;

export function createAppStore(): AppStore {
  return createStore<AppState>(initialAppState);
}
