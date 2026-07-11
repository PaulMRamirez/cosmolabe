// The furnish op: resolve each named kernel through the PAL KernelSource and load its
// bytes into the engine. A missing kernel fails loudly (the engine never reads bytes
// directly). (STK_PARITY_SPEC, SDK.)

import { KernelResolveError } from '../errors.ts';
import type { FurnishOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

/** Reject a furnish name that is absolute or escapes its directory via `..`. */
function assertSafeKernelName(name: string): void {
  const isAbsolute = name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name);
  if (isAbsolute || name.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new KernelResolveError(name, `refusing an unsafe kernel name "${name}"`);
  }
}

export async function runFurnish(op: FurnishOp, ctx: OpContext): Promise<OpResult> {
  for (const name of op.names) {
    assertSafeKernelName(name);
    let bytes: Uint8Array;
    try {
      const handle = await ctx.io.kernels.resolve(name);
      bytes = await ctx.io.kernels.read(handle);
    } catch (cause) {
      throw new KernelResolveError(name, cause);
    }
    await ctx.engine.furnsh(name, bytes);
  }
  return { kind: 'void' };
}
