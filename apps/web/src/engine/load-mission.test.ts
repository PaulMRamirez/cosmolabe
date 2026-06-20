// The mission-load orchestration furnishes each declared kernel exactly once, in
// SPICE-data-before-objects order, and verifies frames, all before any render.
// It fails loudly on an unresolved kernel or frame (CLAUDE.md: no silent fallback).

import { describe, expect, it, vi } from 'vitest';
import type { KernelRef } from '@bessel/catalog';
import { furnishMissionKernels, type FurnishHooks } from './load-mission.ts';

function ref(name: string): KernelRef {
  return { name, source: `https://kernels.example/${name}` };
}

function hooks(over: Partial<FurnishHooks> = {}): { hooks: FurnishHooks; order: string[] } {
  const furnishedNames = new Set<string>();
  const order: string[] = [];
  const base: FurnishHooks = {
    resolve: async (r) => new TextEncoder().encode(r.name),
    furnish: async (name) => {
      order.push(`furnish:${name}`);
      furnishedNames.add(name);
    },
    isFurnished: (name) => furnishedNames.has(name),
    verifyFrame: async (frame) => {
      order.push(`frame:${frame}`);
    },
    ...over,
  };
  return { hooks: base, order };
}

const KERNELS: readonly KernelRef[] = [
  ref('naif0012.tls'),
  ref('pck00011.tpc'),
  ref('de440s.bsp'),
  ref('cassini.bsp'),
];

describe('furnishMissionKernels', () => {
  it('furnishes every declared kernel exactly once, in declaration order', async () => {
    const { hooks: h, order } = hooks();
    const furnished = await furnishMissionKernels(KERNELS, [], h);
    expect(furnished).toEqual(['naif0012.tls', 'pck00011.tpc', 'de440s.bsp', 'cassini.bsp']);
    expect(order).toEqual([
      'furnish:naif0012.tls',
      'furnish:pck00011.tpc',
      'furnish:de440s.bsp',
      'furnish:cassini.bsp',
    ]);
  });

  it('skips kernels already furnished this session (de-dup by name)', async () => {
    const already = new Set(['naif0012.tls', 'pck00011.tpc']);
    const furnish = vi.fn(async () => {});
    const { hooks: h } = hooks({ isFurnished: (n) => already.has(n), furnish });
    const furnished = await furnishMissionKernels(KERNELS, [], h);
    expect(furnished).toEqual(['de440s.bsp', 'cassini.bsp']);
    expect(furnish).toHaveBeenCalledTimes(2);
  });

  it('verifies frames only after all kernels are furnished', async () => {
    const { hooks: h, order } = hooks();
    await furnishMissionKernels([ref('a.bsp'), ref('b.bsp')], ['IAU_SATURN'], h);
    expect(order).toEqual(['furnish:a.bsp', 'furnish:b.bsp', 'frame:IAU_SATURN']);
  });

  it('fails loudly on an unresolved kernel and never furnishes it', async () => {
    const furnish = vi.fn(async () => {});
    const { hooks: h } = hooks({
      furnish,
      resolve: async (r) => {
        if (r.name === 'missing.bsp') throw new Error('kernel-not-found: missing.bsp');
        return new Uint8Array();
      },
    });
    await expect(
      furnishMissionKernels([ref('ok.bsp'), ref('missing.bsp')], [], h),
    ).rejects.toThrow(/missing\.bsp/);
    expect(furnish).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when a declared frame does not resolve', async () => {
    const { hooks: h } = hooks({
      verifyFrame: async (frame) => {
        throw new Error(`Frame "${frame}" is not resolvable`);
      },
    });
    await expect(furnishMissionKernels([ref('a.bsp')], ['BOGUS_FRAME'], h)).rejects.toThrow(
      /BOGUS_FRAME/,
    );
  });
});
