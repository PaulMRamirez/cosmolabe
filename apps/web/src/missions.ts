// The app's mission catalog, backed by the @bessel/catalog PluginRegistry so the
// registry is surfaced in the shell. A mission plugin mirrors a Cosmographia
// add-on: it declares the SPICE kernels it needs (in dependency order), the
// frames it relies on, and lazily fetches and parses its native catalog when
// activated. Users can still load their own catalogs via the Mission panel (file
// picker or drag and drop).

import {
  PluginRegistry,
  parseBesselCatalog,
  type BesselCatalog,
  type KernelRef,
} from '@bessel/catalog';

// The fixture kernels and catalog, imported as URLs so Vite emits them as hashed
// assets the KernelSource (and fetchCatalog) can resolve, exactly like the boot
// kernels in kernels.ts. The bounded SPK fixtures keep the download tiny.
import lskUrl from '../../../kernels/fixtures/naif0012.tls?url';
import pckUrl from '../../../kernels/fixtures/pck00011.tpc?url';
import de440Url from '../../../kernels/fixtures/de440s-inner-cassini.bsp?url';
import cassiniUrl from '../../../kernels/fixtures/cassini-soi.bsp?url';
import nativeCassiniUrl from '../../../e2e/fixtures/native-cassini.json?url';

/** Fetch and parse a native catalog from a URL, for plugins that register one. */
export async function fetchCatalog(url: string): Promise<BesselCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mission catalog not found at ${url} (${res.status})`);
  return parseBesselCatalog(await res.json());
}

// Cassini at Saturn orbit insertion, furnished in SPICE-data-before-objects order:
// leapseconds, planetary constants, the inner-system ephemeris, then the Cassini
// trajectory SPK. The catalog (Saturn with rings plus the probe arc) loads lazily.
const CASSINI_KERNELS: readonly KernelRef[] = [
  { name: 'naif0012.tls', source: lskUrl },
  { name: 'pck00011.tpc', source: pckUrl },
  { name: 'de440s-inner-cassini.bsp', source: de440Url },
  { name: 'cassini-soi.bsp', source: cassiniUrl },
];

/** Build the mission registry, pre-registering the bundled fixture plugins. */
export function createMissionRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({
    id: 'cassini-soi',
    name: 'Cassini at Saturn',
    description: 'Cassini orbit-insertion arc at Saturn (SPICE SPK), with the ringed globe.',
    kernels: CASSINI_KERNELS,
    frames: ['J2000', 'IAU_SATURN'],
    panels: ['plugins'],
    loadCatalog: () => fetchCatalog(nativeCassiniUrl),
  });
  return registry;
}
