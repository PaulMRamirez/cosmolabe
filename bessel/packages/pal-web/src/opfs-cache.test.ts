import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpfsKernelCache, openKernelCache, openTextureCache } from './opfs-cache.ts';
import { HttpKernelSource } from './kernel-source.ts';

// In-memory fakes of the OPFS handle API, enough to exercise the cache.
class FakeWritable {
  constructor(
    private readonly store: Map<string, Uint8Array>,
    private readonly name: string,
  ) {}
  async write(data: Uint8Array): Promise<void> {
    this.store.set(this.name, data);
  }
  async close(): Promise<void> {}
}
class FakeFileHandle {
  constructor(
    private readonly store: Map<string, Uint8Array>,
    private readonly name: string,
  ) {}
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.store.get(this.name);
    if (!bytes) throw new Error('not found');
    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this.store, this.name);
  }
}
class FakeDir {
  readonly store = new Map<string, Uint8Array>();
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFileHandle> {
    if (!this.store.has(name) && !opts?.create) throw new Error('missing');
    if (opts?.create && !this.store.has(name)) this.store.set(name, new Uint8Array());
    return new FakeFileHandle(this.store, name);
  }
  async getDirectoryHandle(): Promise<FakeDir> {
    return this;
  }
}

describe('@bessel/pal-web OPFS kernel cache', () => {
  it('round-trips bytes and returns null on a miss', async () => {
    const cache = new OpfsKernelCache(new FakeDir() as unknown as FileSystemDirectoryHandle);
    expect(await cache.get('http://x/de440s.bsp')).toBeNull();
    await cache.put('http://x/de440s.bsp', new Uint8Array([1, 2, 3]));
    const got = await cache.get('http://x/de440s.bsp');
    expect(got && Array.from(got)).toEqual([1, 2, 3]);
  });

  it('openKernelCache returns undefined when OPFS is unavailable', async () => {
    expect(await openKernelCache()).toBeUndefined();
  });

  it('openTextureCache returns undefined when OPFS is unavailable', async () => {
    expect(await openTextureCache()).toBeUndefined();
  });
});

describe('@bessel/pal-web HttpKernelSource caching', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('skips the network on a cache hit and writes back on a miss', async () => {
    const dir = new FakeDir();
    const cache = new OpfsKernelCache(dir as unknown as FileSystemDirectoryHandle);
    const url = 'http://kernels/naif0012.tls';
    const source = new HttpKernelSource({ 'naif0012.tls': url }, cache);
    const handle = await source.resolve('naif0012.tls');

    // Miss: fetch is called once and the result cached.
    fetchSpy.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer });
    const first = await source.read(handle);
    expect(Array.from(first)).toEqual([9, 8, 7]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Hit: fetch is not called again.
    const second = await source.read(handle);
    expect(Array.from(second)).toEqual([9, 8, 7]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
