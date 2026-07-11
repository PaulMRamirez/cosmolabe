// Runtime planetary-imagery manager. Given a catalog texture reference or a
// known-body default, it fetches an equirectangular base-map image, caches the
// raw bytes (so a reload and offline use are cheap, mirroring the kernel cache),
// and hands a Three texture to the material. On a miss, an offline error, or no
// known default, callers keep the existing procedural texture: real imagery is
// purely additive and never silently mis-renders (CLAUDE.md fail-loud rule).
//
// No image binaries are bundled: the bytes arrive over the network at runtime
// and live only in the cache. The default URLs point at the Solar System Scope
// 2k equirectangular set (CC-BY 4.0, attribution below). The manager is small
// and free of DOM/WebGL details that cannot be unit tested: image decoding is
// injected, so the URL resolution, cache flow, and fallback are headless-tested.
//
// Attribution (required by CC-BY 4.0): planetary base maps by Solar System Scope
// (https://www.solarsystemscope.com/textures/), derived from NASA elevation and
// imagery data.

import { type Texture } from 'three';

/** A content-addressed byte cache for fetched imagery (an OPFS/PAL adapter, or a stub). */
export interface TextureCache {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
}

/** Inject the network fetch and the (DOM/WebGL) decode so the flow is testable. */
export interface TextureManagerDeps {
  /** Fetch image bytes from a URL; rejects on a network/HTTP error (fail loud). */
  readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Decode image bytes into a Three texture (real: ImageBitmap; tests: a stub). */
  readonly decode: (bytes: Uint8Array, mimeType: string) => Promise<Texture>;
  /** Optional byte cache; absent means every load goes to the network. */
  readonly cache?: TextureCache;
}

/** A loud, located error for a genuine imagery failure (never a silent fallback). */
export class TextureLoadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TextureLoadError';
  }
}

// Default equirectangular base-map URLs for the known solar-system bodies, keyed
// by lower-case body name. Solar System Scope 2k JPEGs (CC-BY 4.0). These are the
// "known-body default" the manager falls back to when a catalog body declares no
// explicit texture; they are fetched at runtime, never bundled.
const SSS = 'https://www.solarsystemscope.com/textures/download';
export const DEFAULT_BODY_TEXTURE_URLS: Readonly<Record<string, string>> = {
  sun: `${SSS}/2k_sun.jpg`,
  mercury: `${SSS}/2k_mercury.jpg`,
  venus: `${SSS}/2k_venus_surface.jpg`,
  earth: `${SSS}/2k_earth_daymap.jpg`,
  moon: `${SSS}/2k_moon.jpg`,
  mars: `${SSS}/2k_mars.jpg`,
  jupiter: `${SSS}/2k_jupiter.jpg`,
  saturn: `${SSS}/2k_saturn.jpg`,
  uranus: `${SSS}/2k_uranus.jpg`,
  neptune: `${SSS}/2k_neptune.jpg`,
  pluto: `${SSS}/2k_pluto.jpg`,
};

/** The known-body default equirectangular image URL, or null when none is known. */
export function defaultBodyTextureUrl(bodyName: string): string | null {
  return DEFAULT_BODY_TEXTURE_URLS[bodyName.toLowerCase()] ?? null;
}

const mimeForUrl = (url: string): string => {
  const u = url.toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

const cacheId = (url: string): string => `tex_${url.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

/**
 * Resolves and caches runtime imagery. load() returns a decoded Three texture,
 * or null when no source is available (so the caller keeps its procedural map),
 * and throws a TextureLoadError only on a genuine fetch/decode failure.
 */
export class TextureManager {
  // In-flight and resolved loads are memoized by URL so two bodies sharing a map
  // (or a re-render) decode once.
  private readonly inflight = new Map<string, Promise<Texture | null>>();

  constructor(private readonly deps: TextureManagerDeps) {}

  /**
   * Load imagery for a body. An explicit catalog URL wins; otherwise the
   * known-body default is used; otherwise null (the body stays procedural).
   */
  loadForBody(bodyName: string, explicitUrl?: string): Promise<Texture | null> {
    const url = explicitUrl ?? defaultBodyTextureUrl(bodyName);
    if (!url) return Promise.resolve(null);
    return this.load(url);
  }

  /** Load (and cache) one image URL into a Three texture; memoized per URL. */
  load(url: string): Promise<Texture | null> {
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const promise = this.fetchAndDecode(url);
    this.inflight.set(url, promise);
    return promise;
  }

  private async fetchAndDecode(url: string): Promise<Texture | null> {
    const id = cacheId(url);
    const cache = this.deps.cache;
    let bytes: Uint8Array | null = null;
    if (cache) {
      try {
        bytes = await cache.get(id);
      } catch {
        // A cache read fault must not block the network path; treat as a miss.
        bytes = null;
      }
    }
    if (!bytes) {
      bytes = await this.deps.fetchBytes(url).catch((err: unknown) => {
        throw new TextureLoadError(`Failed to fetch texture ${url}`, url, { cause: err });
      });
      if (cache) {
        // Persisting is best effort: a write fault must not fail the live load.
        await cache.put(id, bytes).catch(() => undefined);
      }
    }
    try {
      return await this.deps.decode(bytes, mimeForUrl(url));
    } catch (err) {
      throw new TextureLoadError(`Failed to decode texture ${url}`, url, { cause: err });
    }
  }
}
