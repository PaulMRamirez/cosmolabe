// Renderer-side KernelSource that consumes the typed window.bessel bridge. Kernel
// bytes reach the SPICE engine through this source, served by the main process over
// IPC. A serialized PalError from main is rethrown as a real, located PalError.

import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';
import type { BesselBridge, SerializedPalError } from './ipc-contract.ts';

function rethrow(err: unknown, location: string): never {
  if (err instanceof PalError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  // Main encodes located PalErrors as JSON in the error message.
  const start = message.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(message.slice(start)) as { __palError?: SerializedPalError };
      if (parsed.__palError) {
        const p = parsed.__palError;
        throw new PalError(p.message, p.code, p.location);
      }
    } catch (parseErr) {
      if (parseErr instanceof PalError) throw parseErr;
    }
  }
  throw new PalError(message, 'read-failed', location);
}

export class IpcKernelSource implements KernelSource {
  constructor(private readonly bridge: BesselBridge = requireBridge()) {}

  async list(): Promise<KernelHandle[]> {
    return this.bridge.listKernels();
  }

  async resolve(name: string): Promise<KernelHandle> {
    try {
      return await this.bridge.resolveKernel(name);
    } catch (err) {
      rethrow(err, `IpcKernelSource.resolve(${name})`);
    }
  }

  async read(handle: KernelHandle): Promise<Uint8Array> {
    try {
      return await this.bridge.readKernel(handle.id);
    } catch (err) {
      rethrow(err, `IpcKernelSource.read(${handle.name})`);
    }
  }

  async readRange(handle: KernelHandle, offset: number, length: number): Promise<Uint8Array> {
    return this.bridge.readKernelRange(handle.id, offset, length);
  }
}

function requireBridge(): BesselBridge {
  const bridge = (globalThis as { window?: Window }).window?.bessel;
  if (!bridge) {
    throw new PalError('Electron bridge (window.bessel) is unavailable', 'not-supported', 'requireBridge');
  }
  return bridge;
}
