// Renderer-side wrappers over the native dialog bridge. These back the
// Capabilities.fileDialogs flag with real behavior.

import type { BesselBridge } from './ipc-contract.ts';

const KERNEL_EXTENSIONS = ['tm', 'bsp', 'bds', 'tls', 'tpc', 'ti', 'bc', 'bpc'];

/** Open a native file dialog filtered for SPICE kernels; returns the first path or null. */
export async function openKernelDialog(bridge: BesselBridge): Promise<string | null> {
  const files = await bridge.openDialog({
    title: 'Open kernel or meta-kernel',
    filters: [{ name: 'SPICE kernels', extensions: KERNEL_EXTENSIONS }],
  });
  return files?.[0] ?? null;
}

/** Open a native save dialog for an exported product; returns the path or null. */
export async function saveProductDialog(bridge: BesselBridge, defaultPath: string): Promise<string | null> {
  return bridge.saveDialog({ title: 'Save product', defaultPath });
}
