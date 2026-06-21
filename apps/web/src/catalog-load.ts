// Catalog ingestion: parse a dropped or picked file as either a native Bessel
// catalog or a Cosmographia catalog, validate it, and reduce it to the object
// list the browser shows. Invalid input fails loudly with a located message
// (CLAUDE.md: loud, typed errors, never a silent fallback).

import {
  CatalogError,
  parseBesselCatalog,
  parseCosmographiaCatalog,
  type BesselCatalog,
} from '@bessel/catalog';
import { SOLAR_SYSTEM } from '@bessel/scene';
import type { CatalogEntry } from '@bessel/ui';

export type CatalogKind = 'native' | 'cosmographia';

export interface LoadedCatalog {
  readonly name: string;
  readonly kind: CatalogKind;
  readonly entries: readonly CatalogEntry[];
  /** The parsed native catalog, present when kind === 'native', for scene rebuild. */
  readonly catalog?: BesselCatalog;
}

/** The neutral boot object list (inner solar system), shown until a mission loads. */
export const DEFAULT_OBJECT_ENTRIES: readonly CatalogEntry[] = [
  ...SOLAR_SYSTEM.map((p) => ({ id: p.name, name: p.name, kind: 'body' as const })),
];

export async function parseAnyCatalog(filename: string, text: string): Promise<LoadedCatalog> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CatalogError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`, '$');
  }

  if (isRecord(raw) && Array.isArray(raw['items'])) {
    const sc = parseCosmographiaCatalog(raw);
    return {
      name: sc.name || filename,
      kind: 'cosmographia',
      entries: [{ id: sc.name, name: sc.name, kind: 'spacecraft' }],
    };
  }

  if (isRecord(raw) && typeof raw['version'] === 'string') {
    const catalog = await parseBesselCatalog(raw);
    return {
      name: catalog.name || filename,
      kind: 'native',
      entries: nativeEntries(catalog),
      catalog,
    };
  }

  throw new CatalogError(
    'Unrecognized catalog: expected a Cosmographia "items" array or a native "version" field',
    '$',
  );
}

export function nativeEntries(catalog: BesselCatalog): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  // The entry id must match the scene/ephemeris body key (the display name), so
  // selection, centering, and measurement resolve against the rendered scene.
  for (const b of catalog.bodies ?? []) {
    const name = b.name ?? b.id;
    entries.push({ id: name, name, kind: 'body' });
  }
  for (const s of catalog.spacecraft ?? []) {
    const name = s.name ?? s.id;
    entries.push({ id: name, name, kind: 'spacecraft' });
  }
  for (const inst of catalog.instruments ?? []) {
    entries.push({ id: inst.id, name: inst.id, kind: 'instrument' });
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Format a load failure for display, including the located field for catalog errors. */
export function formatLoadError(err: unknown): string {
  if (err instanceof CatalogError) return `${err.location}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
