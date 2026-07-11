import { describe, it, expect, vi } from 'vitest';
import type { KernelHandle, KernelSource } from '@bessel/pal';
import { KernelResolveError } from '../errors.ts';
import type { OpContext } from '../runner/context.ts';
import { runFurnish } from './furnish.ts';

// A kernel source that resolves any name to a 1-byte buffer; used to prove that a safe
// name reaches it and an unsafe name is rejected before it ever does.
function stubKernels(): { source: KernelSource; resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(
    async (name: string): Promise<KernelHandle> => ({ id: name, name }),
  );
  const source: KernelSource = {
    list: async () => [],
    resolve,
    read: async () => new Uint8Array([1]),
  };
  return { source, resolve };
}

function makeCtx(source: KernelSource, furnsh: (n: string, b: Uint8Array) => Promise<void>): OpContext {
  return {
    engine: { furnsh } as unknown as OpContext['engine'],
    io: { kernels: source, writeFile: async () => {} },
    registry: new Map(),
    entities: new Map(),
    defaults: { frame: 'J2000', center: 'EARTH' },
    env: {} as OpContext['env'],
  };
}

describe('runFurnish name validation', () => {
  it.each(['../../../etc/passwd', '/etc/passwd', 'a/../../b', 'C:\\Windows\\system32'])(
    'rejects an unsafe furnish name before resolving it: %s',
    async (name) => {
      const { source, resolve } = stubKernels();
      const furnsh = vi.fn(async () => {});
      const ctx = makeCtx(source, furnsh);
      await expect(runFurnish({ op: 'furnish', names: [name] }, ctx)).rejects.toBeInstanceOf(
        KernelResolveError,
      );
      expect(resolve).not.toHaveBeenCalled();
      expect(furnsh).not.toHaveBeenCalled();
    },
  );

  it('accepts a safe name and furnishes it', async () => {
    const { source, resolve } = stubKernels();
    const furnsh = vi.fn(async () => {});
    const ctx = makeCtx(source, furnsh);
    const result = await runFurnish({ op: 'furnish', names: ['naif0012.tls'] }, ctx);
    expect(resolve).toHaveBeenCalledWith('naif0012.tls');
    expect(furnsh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: 'void' });
  });
});
