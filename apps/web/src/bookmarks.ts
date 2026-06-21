// Saved views (bookmarks): a named list of encoded view hashes persisted through
// the PAL Storage interface (OPFS-backed on native, localStorage on web), not an
// ad hoc global. Each bookmark stores the @bessel/state URL hash so applying it
// reuses the same view reconstruction the shared-URL path uses.

import type { Storage } from '@bessel/pal';

export interface Bookmark {
  readonly id: string;
  readonly name: string;
  /** The encoded view hash (as @bessel/state encodeView produces). */
  readonly hash: string;
}

const KEY = 'bessel:bookmarks';

export async function loadBookmarks(storage: Storage): Promise<Bookmark[]> {
  const raw = await storage.get(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBookmark) : [];
  } catch {
    return [];
  }
}

export async function persistBookmarks(
  storage: Storage,
  bookmarks: readonly Bookmark[],
): Promise<void> {
  await storage.set(KEY, JSON.stringify(bookmarks));
}

export function isBookmark(value: unknown): value is Bookmark {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Bookmark).id === 'string' &&
    typeof (value as Bookmark).name === 'string' &&
    typeof (value as Bookmark).hash === 'string'
  );
}

/**
 * Parse an imported saved-views JSON document, failing loudly (per the product value)
 * so a malformed import is reported rather than silently dropped. Requires a JSON
 * array whose every entry is a well-formed bookmark (id, name, hash).
 */
export function parseBookmarkList(json: string): Bookmark[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Bookmark import: not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('Bookmark import: expected a JSON array of views');
  if (!parsed.every(isBookmark)) {
    throw new Error('Bookmark import: every entry needs an id, name, and view hash');
  }
  return parsed;
}

/** A reasonably unique id for a new bookmark, without relying on wall-clock. */
export function newBookmarkId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback: index-free token from the current high-res time.
  return `bm-${Math.floor(performance.now() * 1000).toString(36)}`;
}
