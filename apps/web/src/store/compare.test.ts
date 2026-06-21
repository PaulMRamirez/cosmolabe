import { describe, expect, it } from 'vitest';
import { createAppStore, KEPT_SNAPSHOT_LIMIT, type KeptSnapshot } from './app-state.ts';

const snap = (id: string): KeptSnapshot => ({
  id,
  tool: 'access',
  name: id,
  metrics: [{ label: 'coverage %', value: '80.0' }],
});

describe('compare tray slice', () => {
  it('starts empty and the limit is four', () => {
    expect(createAppStore().getState().keptSnapshots).toEqual([]);
    expect(KEPT_SNAPSHOT_LIMIT).toBe(4);
  });

  it('appends, removes by id, and clears', () => {
    const store = createAppStore();
    store.setState((s) => ({ keptSnapshots: [...s.keptSnapshots, snap('a'), snap('b')] }));
    expect(store.getState().keptSnapshots.map((k) => k.id)).toEqual(['a', 'b']);
    store.setState((s) => ({ keptSnapshots: s.keptSnapshots.filter((k) => k.id !== 'a') }));
    expect(store.getState().keptSnapshots.map((k) => k.id)).toEqual(['b']);
    store.setState({ keptSnapshots: [] });
    expect(store.getState().keptSnapshots).toEqual([]);
  });
});
