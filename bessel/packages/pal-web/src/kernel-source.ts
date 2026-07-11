// HTTP KernelSource: resolves logical kernel names to URLs, fetches them (with
// range support where the server allows it), and caches full reads in OPFS. Fails
// loudly with a located PalError on an unknown name or a failed fetch.

import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';
import type { KernelCache } from './opfs-cache.ts';

export class HttpKernelSource implements KernelSource {
  constructor(
    private readonly urls: Readonly<Record<string, string>>,
    private readonly cache?: KernelCache,
  ) {}

  async list(): Promise<KernelHandle[]> {
    return Object.entries(this.urls).map(([name, url]) => ({ id: url, name }));
  }

  async resolve(name: string): Promise<KernelHandle> {
    const url = this.urls[name];
    if (!url) {
      throw new PalError(
        `Kernel "${name}" is not registered in this source`,
        'kernel-not-found',
        `HttpKernelSource.resolve(${name})`,
      );
    }
    return { id: url, name };
  }

  async read(handle: KernelHandle): Promise<Uint8Array> {
    if (this.cache) {
      const hit = await this.cache.get(handle.id);
      if (hit) return hit;
    }
    const res = await fetch(handle.id);
    if (!res.ok) {
      throw new PalError(
        `Failed to fetch kernel "${handle.name}": ${res.status} ${res.statusText}`,
        'read-failed',
        `HttpKernelSource.read(${handle.name})`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (this.cache) await this.cache.put(handle.id, bytes);
    return bytes;
  }

  async readRange(handle: KernelHandle, offset: number, length: number): Promise<Uint8Array> {
    const res = await fetch(handle.id, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new PalError(
        `Failed range fetch for kernel "${handle.name}": ${res.status} ${res.statusText}`,
        'read-failed',
        `HttpKernelSource.readRange(${handle.name})`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A 200 means the server ignored the Range header and sent the whole body; slice
    // the requested window ourselves so the caller never receives more than it asked
    // for. A 206 already carries exactly the requested range.
    if (res.status === 200) {
      return bytes.subarray(offset, offset + length);
    }
    return bytes;
  }
}
