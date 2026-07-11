import { describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import {
  TextureManager,
  TextureLoadError,
  defaultBodyTextureUrl,
  type TextureCache,
} from './texture-manager.ts';

const decodeStub = (): Promise<Texture> => Promise.resolve(new Texture());

describe('defaultBodyTextureUrl', () => {
  it('resolves a known body (case-insensitive) and returns null otherwise', () => {
    expect(defaultBodyTextureUrl('Earth')).toContain('earth');
    expect(defaultBodyTextureUrl('MARS')).toContain('mars');
    expect(defaultBodyTextureUrl('Cassini')).toBeNull();
  });
});

describe('TextureManager.loadForBody', () => {
  it('returns null (procedural fallback) for an unknown body with no explicit url', async () => {
    const fetchBytes = vi.fn();
    const mgr = new TextureManager({ fetchBytes, decode: decodeStub });
    expect(await mgr.loadForBody('Cassini')).toBeNull();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('fetches the known-body default and decodes a texture', async () => {
    const fetchBytes = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const mgr = new TextureManager({ fetchBytes, decode: decodeStub });
    const tex = await mgr.loadForBody('Earth');
    expect(tex).toBeInstanceOf(Texture);
    expect(fetchBytes).toHaveBeenCalledWith(expect.stringContaining('earth'));
  });

  it('prefers an explicit catalog url over the body default', async () => {
    const fetchBytes = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const mgr = new TextureManager({ fetchBytes, decode: decodeStub });
    await mgr.loadForBody('Earth', 'https://example.test/custom.png');
    expect(fetchBytes).toHaveBeenCalledWith('https://example.test/custom.png');
  });
});

describe('TextureManager cache flow', () => {
  it('serves cached bytes without a network fetch, and writes through on a miss', async () => {
    const store = new Map<string, Uint8Array>();
    const cache: TextureCache = {
      get: (id) => Promise.resolve(store.get(id) ?? null),
      put: (id, bytes) => {
        store.set(id, bytes);
        return Promise.resolve();
      },
    };
    const fetchBytes = vi.fn().mockResolvedValue(new Uint8Array([9]));
    const mgr1 = new TextureManager({ fetchBytes, decode: decodeStub, cache });
    await mgr1.load('https://example.test/a.jpg');
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    // A fresh manager (new in-flight memo) reuses the cache, not the network.
    const mgr2 = new TextureManager({ fetchBytes, decode: decodeStub, cache });
    await mgr2.load('https://example.test/a.jpg');
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it('memoizes concurrent loads of the same url to a single fetch', async () => {
    const fetchBytes = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const mgr = new TextureManager({ fetchBytes, decode: decodeStub });
    const [a, b] = await Promise.all([
      mgr.load('https://example.test/x.jpg'),
      mgr.load('https://example.test/x.jpg'),
    ]);
    expect(a).toBe(b);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });
});

describe('TextureManager fail-loud', () => {
  it('throws a located TextureLoadError when the fetch fails (offline)', async () => {
    const fetchBytes = vi.fn().mockRejectedValue(new Error('offline'));
    const mgr = new TextureManager({ fetchBytes, decode: decodeStub });
    await expect(mgr.load('https://example.test/down.jpg')).rejects.toBeInstanceOf(
      TextureLoadError,
    );
  });

  it('throws a located TextureLoadError when decoding fails', async () => {
    const fetchBytes = vi.fn().mockResolvedValue(new Uint8Array([0]));
    const decode = vi.fn().mockRejectedValue(new Error('bad image'));
    const mgr = new TextureManager({ fetchBytes, decode });
    await expect(mgr.load('https://example.test/corrupt.jpg')).rejects.toMatchObject({
      name: 'TextureLoadError',
      url: 'https://example.test/corrupt.jpg',
    });
  });
});
