// @bessel/pal-node: the Node IO a shell injects into the headless SDK runner. A
// directory-backed KernelSource (reusing the Electron NodeKernelSource) and a writer
// confined to an output directory, assembled into the runner's RunIo shape. Node-only
// (imports node:fs); never pulled into a browser bundle. (STK_PARITY_SPEC, SDK.)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { PalError, type KernelSource } from '@bessel/pal';
import { NodeKernelSource } from '@bessel/pal-electron/node';

/** The minimal IO the SDK runJob needs; structurally equal to @bessel/sdk's RunIo. */
export interface NodeRunIo {
  readonly kernels: KernelSource;
  writeFile(relPath: string, data: Uint8Array): Promise<void>;
}

/** A KernelSource that serves kernels from `dir`. */
export function createNodeKernelSource(dir: string): KernelSource {
  return new NodeKernelSource(resolve(dir));
}

/**
 * A writer confined to `outDir`: a relative path escaping the directory (via `..` or an
 * absolute path) fails loudly rather than writing outside the sandbox. Creates parent
 * directories as needed.
 */
export function createNodeFileWriter(outDir: string): (relPath: string, data: Uint8Array) => Promise<void> {
  const root = resolve(outDir);
  return async (relPath: string, data: Uint8Array): Promise<void> => {
    if (isAbsolute(relPath)) throw new PalError(`refusing to write an absolute path "${relPath}"`, 'write-failed', 'createNodeFileWriter');
    const target = resolve(root, relPath);
    const rel = relative(root, target);
    if (rel.startsWith('..')) throw new PalError(`refusing to write outside the output dir: "${relPath}"`, 'write-failed', 'createNodeFileWriter');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  };
}

/** Assemble the runner IO from a kernel directory and an output directory. */
export function createNodeRunIo(opts: { kernelDir: string; outDir: string }): NodeRunIo {
  return {
    kernels: createNodeKernelSource(opts.kernelDir),
    writeFile: createNodeFileWriter(opts.outDir),
  };
}

export { NodeKernelSource };
