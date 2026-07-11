import { describe, expect, it, vi } from 'vitest';
import { createStore } from './create-store.ts';

interface Counter {
  n: number;
  label: string;
}

describe('createStore', () => {
  it('returns the current state from getState', () => {
    const store = createStore<Counter>({ n: 1, label: 'a' });
    expect(store.getState()).toEqual({ n: 1, label: 'a' });
  });

  it('merges a partial patch and notifies subscribers', () => {
    const store = createStore<Counter>({ n: 1, label: 'a' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ n: 2 });
    expect(store.getState()).toEqual({ n: 2, label: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports functional updates', () => {
    const store = createStore<Counter>({ n: 1, label: 'a' });
    store.setState((s) => ({ n: s.n + 10 }));
    expect(store.getState().n).toBe(11);
  });

  it('does not notify when no field changes by reference', () => {
    const store = createStore<Counter>({ n: 1, label: 'a' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ n: 1, label: 'a' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore<Counter>({ n: 1, label: 'a' });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState({ n: 5 });
    expect(listener).not.toHaveBeenCalled();
  });
});
