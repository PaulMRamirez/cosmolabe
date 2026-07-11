// A tiny external store built on the React useSyncExternalStore contract. It
// holds one typed state object, notifies subscribers on change, and lets the
// imperative engine read live state (getState) inside the RAF loop without React
// re-subscription. No external dependency: this replaces both the viewer's many
// useState hooks and the mirror refs (playingRef, rateRef, etc.).

export type Listener = () => void;

export interface Store<S> {
  getState(): S;
  setState(patch: Partial<S> | ((prev: S) => Partial<S>)): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();

  const getState = (): S => state;

  const setState = (patch: Partial<S> | ((prev: S) => Partial<S>)): void => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof S)[]) {
      if (!Object.is(state[key], next[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState, setState, subscribe };
}
