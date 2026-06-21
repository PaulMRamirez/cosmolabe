// Named scripts: a persisted list of cosmoscripting programs, stored through the PAL
// Storage interface (OPFS-backed on native, localStorage on web), not an ad hoc global.
// Mirrors bookmarks.ts so the scripting console can save, reload, and delete programs
// across sessions.

import type { Storage } from '@bessel/pal';

export interface SavedScript {
  readonly name: string;
  /** The script source (one `verb arg...` per line). */
  readonly source: string;
}

const KEY = 'bessel:scripts';

export async function loadSavedScripts(storage: Storage): Promise<SavedScript[]> {
  const raw = await storage.get(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedScript) : [];
  } catch {
    return [];
  }
}

export async function persistSavedScripts(
  storage: Storage,
  scripts: readonly SavedScript[],
): Promise<void> {
  await storage.set(KEY, JSON.stringify(scripts));
}

export function isSavedScript(value: unknown): value is SavedScript {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SavedScript).name === 'string' &&
    typeof (value as SavedScript).source === 'string'
  );
}

/** Upsert a named script (replace any with the same name) and return the new list,
 *  sorted by name so the console's load menu is stable. */
export function upsertScript(
  scripts: readonly SavedScript[],
  name: string,
  source: string,
): SavedScript[] {
  const next = scripts.filter((s) => s.name !== name);
  next.push({ name, source });
  next.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}
