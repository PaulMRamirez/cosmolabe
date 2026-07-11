// B16: named scripts persist through the PAL Storage interface and upsert by name.

import { describe, it, expect } from 'vitest';
import type { Storage } from '@bessel/pal';
import {
  loadSavedScripts,
  persistSavedScripts,
  isSavedScript,
  upsertScript,
  type SavedScript,
} from './scripts.ts';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

describe('upsertScript', () => {
  it('adds a new script and keeps the list name-sorted', () => {
    const next = upsertScript([{ name: 'b', source: 'pause' }], 'a', 'play');
    expect(next.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('replaces a script with the same name rather than duplicating it', () => {
    const next = upsertScript([{ name: 'a', source: 'pause' }], 'a', 'unpause');
    expect(next).toEqual([{ name: 'a', source: 'unpause' }]);
  });
});

describe('isSavedScript', () => {
  it('accepts a well-formed entry and rejects malformed ones', () => {
    expect(isSavedScript({ name: 'a', source: 's' })).toBe(true);
    expect(isSavedScript({ name: 'a' })).toBe(false);
    expect(isSavedScript(null)).toBe(false);
  });
});

describe('persist + load round-trip', () => {
  it('survives a storage round-trip and tolerates bad JSON', async () => {
    const storage = memoryStorage();
    const scripts: SavedScript[] = [{ name: 'flyby', source: 'gotoObject Titan' }];
    await persistSavedScripts(storage, scripts);
    expect(await loadSavedScripts(storage)).toEqual(scripts);

    await storage.set('bessel:scripts', '{ not json');
    expect(await loadSavedScripts(storage)).toEqual([]);
  });
});
