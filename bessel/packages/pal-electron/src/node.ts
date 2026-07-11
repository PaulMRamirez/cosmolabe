// Node-only entry for @bessel/pal-electron: the main-process filesystem kernel
// source and meta-kernel resolution. Kept separate from the package root so the
// renderer (browser) bundle never pulls in node:fs.

export { NodeKernelSource } from './kernel-source.ts';
export {
  resolveMetaKernel,
  resolveLoadableKernels,
  confineMetaKernelPath,
  type MetaKernel,
} from './meta-kernel.ts';
