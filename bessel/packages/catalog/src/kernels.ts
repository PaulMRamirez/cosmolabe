// Resolve the kernels a catalog references through the PAL KernelSource. A broken
// kernel reference (a name the source cannot resolve) surfaces as a typed, located
// error, never a silent re-center on the Sun (the loud-failure principle).

import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';
import type { BesselCatalog } from './native-types.ts';

/** Collect every kernel name a catalog references (paths and meta-kernels). */
export function catalogKernelNames(catalog: BesselCatalog): string[] {
  const names = new Set<string>();
  for (const p of catalog.kernels?.paths ?? []) names.add(p);
  for (const m of catalog.kernels?.metaKernels ?? []) names.add(m);
  return [...names];
}

/**
 * Resolve all kernels a catalog references. Throws a located PalError naming the
 * first kernel that cannot be resolved.
 */
export async function resolveCatalogKernels(
  catalog: BesselCatalog,
  source: KernelSource,
): Promise<KernelHandle[]> {
  const handles: KernelHandle[] = [];
  for (const name of catalogKernelNames(catalog)) {
    try {
      handles.push(await source.resolve(name));
    } catch (err) {
      if (err instanceof PalError) throw err;
      throw new PalError(
        `Catalog kernel "${name}" could not be resolved`,
        'kernel-not-found',
        `catalog.kernels:${name}`,
      );
    }
  }
  return handles;
}
