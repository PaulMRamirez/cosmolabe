// @bessel/pal-electron: the Electron Platform implementation. Node filesystem
// over a typed IPC bridge from preload, with meta-kernel (.tm) path resolution
// for desktop parity (Phase 3) and the optional Python scripting bridge. The
// Capabilities advertise the Python bridge as present on Electron only.

import {
  PalError,
  type Capabilities,
  type FileSystem,
  type Platform,
  type Share,
  type Storage,
} from '@bessel/pal';
import type { BesselBridge } from './ipc-contract.ts';
import { IpcKernelSource } from './ipc-kernel-source.ts';

// Node-only modules (NodeKernelSource, meta-kernel resolution) live in the
// "@bessel/pal-electron/node" entry so the renderer bundle never imports node:fs.
export { IpcKernelSource } from './ipc-kernel-source.ts';
export { openKernelDialog, saveProductDialog } from './dialogs.ts';
export { runBatchGeometry } from './python.ts';
export {
  BESSEL_IPC,
  type BesselBridge,
  type SerializedPalError,
  type DialogOpenOptions,
  type DialogSaveOptions,
  type PythonRunRequest,
  type PythonRunResult,
} from './ipc-contract.ts';

export const electronCapabilities: Capabilities = {
  target: 'electron',
  pythonBridge: true,
  webxr: false,
  nativeShare: true,
  fileDialogs: true,
};

class RendererStorage implements Storage {
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

class ElectronShare implements Share {
  constructor(private readonly bridge: BesselBridge) {}
  async shareLink(request: { title: string; url: string }): Promise<string> {
    await globalThis.navigator?.clipboard?.writeText(request.url).catch(() => undefined);
    return request.url;
  }
  async shareFile(request: { fileName: string }): Promise<void> {
    await this.bridge.saveDialog({ title: 'Save product', defaultPath: request.fileName });
  }
}

// App-data filesystem is served by the main process; until those channels are
// needed it fails loudly rather than pretending to write (no silent no-op).
class UnsupportedFileSystem implements FileSystem {
  private fail(): never {
    throw new PalError('Electron app-data filesystem is not yet wired', 'not-supported', 'ElectronFileSystem');
  }
  async readFile(): Promise<Uint8Array> {
    this.fail();
  }
  async writeFile(): Promise<void> {
    this.fail();
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async remove(): Promise<void> {
    this.fail();
  }
  async list(): Promise<string[]> {
    this.fail();
  }
}

/** Build the Electron renderer Platform from the injected bridge. */
export async function createElectronPlatform(bridge: BesselBridge): Promise<Platform> {
  const pythonBridge = await bridge.pythonAvailable().catch(() => false);
  return {
    kernels: new IpcKernelSource(bridge),
    fs: new UnsupportedFileSystem(),
    storage: new RendererStorage(),
    share: new ElectronShare(bridge),
    capabilities: { ...electronCapabilities, pythonBridge },
  };
}
