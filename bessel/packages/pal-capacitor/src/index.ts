// @bessel/pal-capacitor: the Capacitor Platform implementation. Capacitor
// Filesystem for kernels and app data, Preferences for storage, Share for links
// and files. Native filesystem kernel import (zip) lands in Phase 3. The Python
// scripting bridge is Electron-only, so it is absent here.

import type { Capabilities } from '@bessel/pal';

export { CapacitorKernelSource, importKernelZip } from './kernel-source.ts';

export const capacitorCapabilities: Capabilities = {
  target: 'capacitor',
  pythonBridge: false,
  webxr: false,
  nativeShare: true,
  fileDialogs: false,
};
