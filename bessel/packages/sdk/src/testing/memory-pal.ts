// In-memory PAL helpers for headless tests: a KernelSource over a byte map and a RunIo
// that records written artifacts. Lets a full job run deterministically with no disk.
// Test-only; not part of the public package surface. (STK_PARITY_SPEC, SDK.)

import type { KernelHandle, KernelSource } from '@bessel/pal';
import type { RunIo } from '../runner/context.ts';

class PalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PalError';
  }
}

/** A KernelSource backed by an in-memory name -> bytes map. */
export function memoryKernelSource(map: ReadonlyMap<string, Uint8Array>): KernelSource {
  return {
    async list(): Promise<KernelHandle[]> {
      return [...map.entries()].map(([name, bytes]) => ({ id: name, name, size: bytes.length }));
    },
    async resolve(name: string): Promise<KernelHandle> {
      const bytes = map.get(name);
      if (!bytes) throw new PalError(`kernel not found: ${name}`);
      return { id: name, name, size: bytes.length };
    },
    async read(handle: KernelHandle): Promise<Uint8Array> {
      const bytes = map.get(handle.name);
      if (!bytes) throw new PalError(`kernel not found: ${handle.name}`);
      return bytes;
    },
  };
}

/**
 * A RunIo that serves kernels from `kernels` and records writes into the returned map.
 * `texts` (optional) backs the readText seam so a loadCatalog op can read a catalog file.
 */
export function recordingIo(
  kernels: KernelSource,
  texts?: ReadonlyMap<string, string>,
): { io: RunIo; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const io: RunIo = {
    kernels,
    async writeFile(relPath: string, data: Uint8Array): Promise<void> {
      files.set(relPath, data);
    },
    ...(texts
      ? {
          async readText(relPath: string): Promise<string> {
            const text = texts.get(relPath);
            if (text === undefined) throw new PalError(`text not found: ${relPath}`);
            return text;
          },
        }
      : {}),
  };
  return { io, files };
}
