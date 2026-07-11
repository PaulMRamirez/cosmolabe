// Mission plugin registry (item 6, JUICE-style extensibility). A plugin bundles
// the kernels, frames, and UI panels a mission contributes, plus a lazy loader
// for its catalog so a large mission is only fetched and parsed when activated.
// Pure data and promises: no SPICE, no Three.js, no UI, so it is unit-testable
// and sits at the lowest layer of the dependency rule.

import { CatalogError, type BesselCatalog } from './index.ts';

/**
 * A reference to one kernel a plugin needs furnished. Mirrors a Cosmographia
 * add-on's spiceKernels[] entry: a logical name plus a PAL/KernelSource
 * resolvable source (a URL or PAL handle path, never a host filesystem path).
 * Kernels are furnished in declaration order so SPICE data precedes the objects
 * that depend on it (Cosmographia's "load in order of information dependency").
 */
export interface KernelRef {
  /** Logical kernel name used to de-duplicate and to furnish into SPICE. */
  readonly name: string;
  /** PAL/KernelSource-resolvable source for the bytes (e.g. a URL). */
  readonly source: string;
  /** True when this is a metakernel that furnishes the kernels it lists. */
  readonly meta?: boolean;
}

export interface MissionPlugin {
  readonly id: string;
  readonly name: string;
  /** One-line summary, mirroring a Cosmographia add-on's description. */
  readonly description?: string;
  /** Kernels this plugin needs furnished, in SPICE-data-before-objects order. */
  readonly kernels: readonly KernelRef[];
  /** SPICE frames this plugin defines or relies on. */
  readonly frames?: readonly string[];
  /** UI panel ids this plugin contributes (resolved by the shell). */
  readonly panels?: readonly string[];
  /** Lazily load the plugin's catalog; called at most once per plugin. */
  readonly loadCatalog: () => Promise<BesselCatalog>;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, MissionPlugin>();
  private readonly loaded = new Map<string, Promise<BesselCatalog>>();

  /** Register a plugin. Duplicate ids fail loudly (no silent overwrite). */
  register(plugin: MissionPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new CatalogError(`Duplicate plugin id "${plugin.id}"`, `$.plugins["${plugin.id}"]`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  list(): MissionPlugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): MissionPlugin | undefined {
    return this.plugins.get(id);
  }

  /** All kernels declared by registered plugins, de-duplicated by name, in registration order. */
  requiredKernels(): KernelRef[] {
    const seen = new Set<string>();
    const out: KernelRef[] = [];
    for (const plugin of this.plugins.values()) {
      for (const k of plugin.kernels) {
        if (!seen.has(k.name)) {
          seen.add(k.name);
          out.push(k);
        }
      }
    }
    return out;
  }

  /** Lazily load and cache a plugin's catalog. Unknown ids fail loudly. */
  async activate(id: string): Promise<BesselCatalog> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new CatalogError(`Unknown plugin "${id}"`, `$.plugins["${id}"]`);
    let pending = this.loaded.get(id);
    if (!pending) {
      pending = plugin.loadCatalog();
      this.loaded.set(id, pending);
    }
    return pending;
  }

  isActivated(id: string): boolean {
    return this.loaded.has(id);
  }
}
