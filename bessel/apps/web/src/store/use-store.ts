// React binding for the external store. useStore subscribes a component to a
// selected slice of state; it re-renders only when that slice changes (reference
// equality), so the engine can write high-frequency fields (et, epochLabel)
// without forcing unrelated panels to re-render.

import { useSyncExternalStore } from 'react';
import type { Store } from './create-store.ts';

export function useStore<S extends object, T>(store: Store<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
