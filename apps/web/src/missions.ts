// The app's mission catalog, backed by the @bessel/catalog PluginRegistry so the
// registry is surfaced in the shell. The app ships no bundled missions; a host
// or plugin registers MissionPlugins here (each lazily fetches and parses its
// native catalog when activated). Users load their own catalogs via the Mission
// panel (file picker or drag and drop).

import { PluginRegistry, parseBesselCatalog, type BesselCatalog } from '@bessel/catalog';

/** Fetch and parse a native catalog from a URL, for plugins that register one. */
export async function fetchCatalog(url: string): Promise<BesselCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mission catalog not found at ${url} (${res.status})`);
  return parseBesselCatalog(await res.json());
}

/** Build the (initially empty) mission registry. */
export function createMissionRegistry(): PluginRegistry {
  return new PluginRegistry();
}
