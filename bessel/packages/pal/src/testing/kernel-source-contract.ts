// Shared conformance suite for KernelSource implementations. pal-web and
// pal-electron run the same contract against their own fixtures (SPEC Section 6),
// so the engine behaves identically no matter how kernel bytes arrive.

import { describe, it, expect } from 'vitest';
import { PalError, type KernelSource } from '../index.ts';

export interface KernelSourceFixture {
  readonly source: KernelSource;
  /** A kernel name the source can resolve. */
  readonly presentName: string;
  /** A kernel name the source cannot resolve. */
  readonly missingName: string;
}

export function kernelSourceContract(
  label: string,
  setup: () => Promise<KernelSourceFixture> | KernelSourceFixture,
): void {
  describe(`KernelSource contract: ${label}`, () => {
    it('lists available kernels', async () => {
      const { source, presentName } = await setup();
      const names = (await source.list()).map((h) => h.name);
      expect(names).toContain(presentName);
    });

    it('resolves a present kernel to a stable handle', async () => {
      const { source, presentName } = await setup();
      const handle = await source.resolve(presentName);
      expect(handle.name).toBe(presentName);
      expect(typeof handle.id).toBe('string');
      expect(handle.id.length).toBeGreaterThan(0);
    });

    it('reads the full kernel bytes', async () => {
      const { source, presentName } = await setup();
      const handle = await source.resolve(presentName);
      const bytes = await source.read(handle);
      expect(bytes.byteLength).toBeGreaterThan(0);
    });

    it('reads a byte range consistent with the full read when supported', async () => {
      const { source, presentName } = await setup();
      const handle = await source.resolve(presentName);
      if (!source.readRange) return;
      const full = await source.read(handle);
      const range = await source.readRange(handle, 0, 8);
      expect(range.byteLength).toBe(8);
      for (let i = 0; i < 8; i++) expect(range[i]).toBe(full[i]);
    });

    it('fails loudly with a typed error for a missing kernel', async () => {
      const { source, missingName } = await setup();
      await expect(source.resolve(missingName)).rejects.toBeInstanceOf(PalError);
    });
  });
}
