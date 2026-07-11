import { describe, expect, it } from 'vitest';
import {
  loadBookmarks,
  persistBookmarks,
  parseBookmarkList,
  newBookmarkId,
  type Bookmark,
} from './bookmarks.ts';
import type { Storage } from '@bessel/pal';

function fakeStorage(initial?: string): Storage & { value: string | null } {
  return {
    value: initial ?? null,
    async get(_key: string) {
      return this.value;
    },
    async set(_key: string, value: string) {
      this.value = value;
    },
    async remove() {
      this.value = null;
    },
  };
}

const sample: Bookmark = { id: 'a', name: 'Earth view', hash: '#t=x' };

describe('bookmarks persistence', () => {
  it('returns an empty list when nothing is stored', async () => {
    expect(await loadBookmarks(fakeStorage())).toEqual([]);
  });

  it('round-trips through persist and load', async () => {
    const storage = fakeStorage();
    await persistBookmarks(storage, [sample]);
    expect(await loadBookmarks(storage)).toEqual([sample]);
  });

  it('ignores malformed stored data', async () => {
    expect(await loadBookmarks(fakeStorage('{ not json'))).toEqual([]);
    expect(await loadBookmarks(fakeStorage(JSON.stringify([{ id: 1 }])))).toEqual([]);
  });

  it('generates distinct ids', () => {
    expect(newBookmarkId()).not.toBe(newBookmarkId());
  });
});

describe('parseBookmarkList (import)', () => {
  it('round-trips a valid exported array', () => {
    expect(parseBookmarkList(JSON.stringify([sample]))).toEqual([sample]);
  });

  it('fails loudly on non-JSON', () => {
    expect(() => parseBookmarkList('{ not json')).toThrow(/^Bookmark import:/);
  });

  it('fails loudly on a JSON object that is not an array', () => {
    expect(() => parseBookmarkList(JSON.stringify(sample))).toThrow(/^Bookmark import:/);
  });

  it('fails loudly when an entry is missing its view hash', () => {
    expect(() => parseBookmarkList(JSON.stringify([{ id: 'a', name: 'x' }]))).toThrow(
      /^Bookmark import:/,
    );
  });
});
