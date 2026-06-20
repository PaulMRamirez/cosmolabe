// Web wiring for runtime planetary imagery. Builds a @bessel/scene TextureManager
// with a real network fetch and an ImageBitmap-based decode, backed by the OPFS
// texture cache (mirroring the kernel cache) so fetched maps survive reloads and
// work offline. This module is loaded lazily by the engine the first time real
// imagery is enabled, so the decode path and the URL table stay out of the
// first-paint shell.

import { TextureManager } from '@bessel/scene';
import { openTextureCache } from '@bessel/pal-web';
import { Texture } from 'three';

/** Fetch image bytes over HTTP; throws on a network/HTTP error so the manager fails loud. */
async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Decode image bytes into a Three texture via createImageBitmap (off-thread decode). */
async function decodeImage(bytes: Uint8Array, mimeType: string): Promise<Texture> {
  const blob = new Blob([bytes], { type: mimeType });
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const texture = new Texture(bitmap);
  texture.needsUpdate = true;
  return texture;
}

/** Build the runtime TextureManager the engine uses for real planetary imagery. */
export async function createWebTextureManager(): Promise<TextureManager> {
  const cache = await openTextureCache();
  return new TextureManager({
    fetchBytes: fetchImageBytes,
    decode: decodeImage,
    ...(cache ? { cache } : {}),
  });
}
