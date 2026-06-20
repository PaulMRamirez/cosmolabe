// Item 6 (plugin registry): register mission plugins, enumerate their required
// kernels, and lazily load each catalog at most once.

import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry, type MissionPlugin, type KernelRef } from './plugins.ts';
import type { BesselCatalog } from './native-types.ts';

function ref(name: string): KernelRef {
  return { name, source: `https://kernels.example/${name}` };
}

function plugin(id: string, kernels: string[], load: () => Promise<BesselCatalog>): MissionPlugin {
  return { id, name: id.toUpperCase(), kernels: kernels.map(ref), loadCatalog: load };
}

const CATALOG: BesselCatalog = { version: '1.0', name: 'X' };

describe('PluginRegistry', () => {
  it('registers and lists plugins, and rejects duplicate ids loudly', () => {
    const reg = new PluginRegistry();
    reg.register(plugin('juice', ['juice.bsp'], async () => CATALOG));
    expect(reg.list().map((p) => p.id)).toEqual(['juice']);
    expect(reg.get('juice')?.name).toBe('JUICE');
    expect(() => reg.register(plugin('juice', [], async () => CATALOG))).toThrow(/Duplicate/);
  });

  it('de-duplicates required kernel refs by name across plugins in registration order', () => {
    const reg = new PluginRegistry();
    reg.register(plugin('a', ['lsk.tls', 'a.bsp'], async () => CATALOG));
    reg.register(plugin('b', ['lsk.tls', 'b.bsp'], async () => CATALOG));
    expect(reg.requiredKernels().map((k) => k.name)).toEqual(['lsk.tls', 'a.bsp', 'b.bsp']);
    // The first occurrence's source wins (registration order, not the later duplicate).
    expect(reg.requiredKernels()[0]?.source).toBe('https://kernels.example/lsk.tls');
  });

  it('activates lazily and caches: loadCatalog runs once across repeated activations', async () => {
    const load = vi.fn(async () => CATALOG);
    const reg = new PluginRegistry();
    reg.register(plugin('cassini', ['cas.bsp'], load));
    expect(reg.isActivated('cassini')).toBe(false);
    const first = await reg.activate('cassini');
    const second = await reg.activate('cassini');
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    expect(reg.isActivated('cassini')).toBe(true);
  });

  it('fails loudly when activating an unknown plugin', async () => {
    const reg = new PluginRegistry();
    await expect(reg.activate('nope')).rejects.toThrow(/Unknown plugin/);
  });
});
