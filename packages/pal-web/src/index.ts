// @bessel/pal-web: the web Platform implementation. KernelSource fetches kernels
// over HTTP (range-capable) with an OPFS-backed cache; Storage uses localStorage;
// Share copies links. The core depends only on @bessel/pal, so this module is
// injected by the web shell at startup (the dependency rule, CLAUDE.md).

import {
  PalError,
  type Capabilities,
  type FileSystem,
  type KernelHandle,
  type KernelSource,
  type Platform,
  type Share,
  type ShareFileRequest,
  type ShareLinkRequest,
  type Storage,
} from '@bessel/pal';

export { HttpKernelSource } from './kernel-source.ts';
export { OpfsKernelCache, openKernelCache, openTextureCache } from './opfs-cache.ts';

import { HttpKernelSource } from './kernel-source.ts';
import { openKernelCache } from './opfs-cache.ts';

class LocalStorageBackend implements Storage {
  async get(key: string): Promise<string | null> {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    globalThis.localStorage?.setItem(key, value);
  }
  async remove(key: string): Promise<void> {
    globalThis.localStorage?.removeItem(key);
  }
}

class WebShare implements Share {
  async shareLink(request: ShareLinkRequest): Promise<string> {
    const nav = globalThis.navigator as Navigator & {
      share?: (data: { title?: string; url?: string }) => Promise<void>;
    };
    if (nav?.share) {
      await nav.share({ title: request.title, url: request.url });
      return request.url;
    }
    if (nav?.clipboard?.writeText) {
      // writeText rejects in an insecure or permission-blocked context; surface
      // that loudly rather than reporting a copy that never happened (CLAUDE.md).
      try {
        await nav.clipboard.writeText(request.url);
      } catch (err) {
        throw new PalError(
          `Clipboard write was blocked: ${err instanceof Error ? err.message : String(err)}`,
          'not-supported',
          'WebShare.shareLink',
        );
      }
      return request.url;
    }
    // Neither the Web Share API nor the clipboard is available: fail loudly so the
    // UI does not claim the link was shared or copied when nothing happened.
    throw new PalError(
      'No share or clipboard path is available to share the link',
      'not-supported',
      'WebShare.shareLink',
    );
  }
  async shareFile(request: ShareFileRequest): Promise<void> {
    const blob = new Blob([request.data], { type: request.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = request.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** OPFS-backed FileSystem; throws located PalErrors when OPFS is unavailable. */
class OpfsFileSystem implements FileSystem {
  private async root(): Promise<FileSystemDirectoryHandle> {
    const storage = globalThis.navigator?.storage as
      | { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
      | undefined;
    if (!storage?.getDirectory) {
      throw new PalError('OPFS is not available', 'not-supported', 'OpfsFileSystem.root');
    }
    return storage.getDirectory();
  }
  private async handle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const root = await this.root();
    return root.getFileHandle(path.replace(/^\//, ''), { create });
  }
  async readFile(path: string): Promise<Uint8Array> {
    const file = await (await this.handle(path, false)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const writable = await (await this.handle(path, true)).createWritable();
    await writable.write(data);
    await writable.close();
  }
  async exists(path: string): Promise<boolean> {
    try {
      await this.handle(path, false);
      return true;
    } catch {
      return false;
    }
  }
  async remove(path: string): Promise<void> {
    const root = await this.root();
    await root.removeEntry(path.replace(/^\//, ''));
  }
  async list(_path: string): Promise<string[]> {
    const root = await this.root();
    const names: string[] = [];
    const iterable = root as unknown as AsyncIterable<[string, unknown]>;
    for await (const [name] of iterable) names.push(name);
    return names;
  }
}

export const webCapabilities: Capabilities = {
  target: 'web',
  pythonBridge: false,
  webxr: typeof navigator !== 'undefined' && 'xr' in navigator,
  nativeShare: typeof navigator !== 'undefined' && 'share' in navigator,
  fileDialogs: typeof window !== 'undefined' && 'showOpenFilePicker' in window,
};

export interface WebPlatformOptions {
  /** Map of kernel logical name to fetchable URL. */
  readonly kernelUrls: Readonly<Record<string, string>>;
  /** Cache fetched kernels in OPFS (default true when available). */
  readonly cache?: boolean;
}

/** Build the web Platform the shell injects into core and UI. */
export async function createWebPlatform(options: WebPlatformOptions): Promise<Platform> {
  const cache = options.cache === false ? undefined : await openKernelCache();
  const kernels: KernelSource = new HttpKernelSource(options.kernelUrls, cache);
  return {
    kernels,
    fs: new OpfsFileSystem(),
    storage: new LocalStorageBackend(),
    share: new WebShare(),
    capabilities: webCapabilities,
  };
}

export type { KernelHandle };
