// The loadCatalog op: read a Cosmographia catalog as text through the RunIo seam, parse
// it, and furnish every kernel it references (each resolved through the PAL KernelSource,
// so the engine never reads bytes directly). A missing readText seam, an unparsable
// catalog, or an unresolvable kernel fails loudly. (STK_PARITY_SPEC, SDK.)

import { parseCosmographiaCatalog } from '@bessel/catalog';
import { CatalogLoadError, KernelResolveError } from '../errors.ts';
import type { LoadCatalogOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runLoadCatalog(op: LoadCatalogOp, ctx: OpContext): Promise<OpResult> {
  if (!ctx.io.readText) {
    throw new CatalogLoadError(op.file, new Error('the RunIo does not provide a readText seam'));
  }
  let catalog: ReturnType<typeof parseCosmographiaCatalog>;
  try {
    const text = await ctx.io.readText(op.file);
    catalog = parseCosmographiaCatalog(JSON.parse(text));
  } catch (cause) {
    throw new CatalogLoadError(op.file, cause);
  }

  for (const name of catalog.kernels) {
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
