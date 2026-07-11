import { kernelSourceContract } from '@bessel/pal/testing';
import { IpcKernelSource } from './index.ts';
import type { BesselBridge } from './ipc-contract.ts';

// A fake bridge over an in-memory kernel map, mirroring how the main process serves
// kernels. Missing kernels reject with a serialized PalError, as the main process
// does, so the contract exercises the located-error rethrow path.
function fakeBridge(known: Record<string, Uint8Array>): BesselBridge {
  return {
    platform: 'electron',
    versions: process.versions,
    async listKernels() {
      return Object.keys(known).map((name) => ({ id: name, name }));
    },
    async resolveKernel(name) {
      if (!(name in known)) {
        throw new Error(
          JSON.stringify({
            __palError: { message: `Kernel ${name} not found`, code: 'kernel-not-found', location: `resolve(${name})` },
          }),
        );
      }
      return { id: name, name };
    },
    async readKernel(id) {
      return known[id] ?? new Uint8Array();
    },
    async readKernelRange(id, offset, length) {
      return (known[id] ?? new Uint8Array()).subarray(offset, offset + length);
    },
    async resolveMetaKernel() {
      return [];
    },
    async openDialog() {
      return null;
    },
    async saveDialog() {
      return null;
    },
    async runPython() {
      return { rows: [] };
    },
    async pythonAvailable() {
      return false;
    },
  };
}

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

kernelSourceContract('pal-electron IpcKernelSource', () => ({
  source: new IpcKernelSource(fakeBridge({ 'naif0012.tls': bytes })),
  presentName: 'naif0012.tls',
  missingName: 'does-not-exist.bsp',
}));
