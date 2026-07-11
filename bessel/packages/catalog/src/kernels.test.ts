import { describe, it, expect } from 'vitest';
import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';
import { resolveCatalogKernels } from './index.ts';

// A source that resolves only the kernels it is told about; anything else is a
// broken reference.
function source(known: readonly string[]): KernelSource {
  const set = new Set(known);
  return {
    async list(): Promise<KernelHandle[]> {
      return [...set].map((name) => ({ id: name, name }));
    },
    async resolve(name: string): Promise<KernelHandle> {
      if (!set.has(name)) {
        throw new PalError(`unknown kernel ${name}`, 'kernel-not-found', `source.resolve(${name})`);
      }
      return { id: name, name };
    },
    async read(): Promise<Uint8Array> {
      return new Uint8Array();
    },
  };
}

describe('@bessel/catalog kernel resolution', () => {
  it('resolves the kernels a catalog references', async () => {
    const handles = await resolveCatalogKernels(
      { version: '1.0', kernels: { metaKernels: ['cassini.tm'], paths: ['de440s.bsp'] } },
      source(['cassini.tm', 'de440s.bsp']),
    );
    expect(handles.map((h) => h.name).sort()).toEqual(['cassini.tm', 'de440s.bsp']);
  });

  it('fails loudly with a typed, located error for a broken kernel reference', async () => {
    const catalog = { version: '1.0', kernels: { metaKernels: ['missing.tm'] } };
    await expect(resolveCatalogKernels(catalog, source([]))).rejects.toBeInstanceOf(PalError);
    await resolveCatalogKernels(catalog, source([])).catch((err: unknown) => {
      expect(err).toBeInstanceOf(PalError);
      expect((err as PalError).code).toBe('kernel-not-found');
      expect((err as PalError).location).toContain('missing.tm');
    });
  });
});
