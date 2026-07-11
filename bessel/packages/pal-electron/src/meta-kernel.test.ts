import { isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PalError } from '@bessel/pal';
import {
  confineMetaKernelPath,
  resolveLoadableKernels,
  resolveMetaKernel,
} from './node.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('@bessel/pal-electron meta-kernel resolution', () => {
  it('resolves a .tm with relative paths to absolute, loadable kernels', async () => {
    const kernels = await resolveLoadableKernels(fixture('cassini.tm'));
    expect(kernels).toHaveLength(2);
    expect(kernels.every((k) => isAbsolute(k))).toBe(true);
    expect(kernels[0]!.replace(/\\/g, '/')).toMatch(/lsk\/leap\.tls$/);
    expect(kernels[1]!.replace(/\\/g, '/')).toMatch(/spk\/de\.bsp$/);
  });

  it('substitutes PATH_SYMBOLS from PATH_SYMBOLS and PATH_VALUES', async () => {
    const meta = await resolveMetaKernel(fixture('cassini.tm'));
    expect(meta.kernels.some((k) => k.includes('lsk'))).toBe(true);
    expect(meta.kernels.some((k) => k.includes('$'))).toBe(false);
  });

  it('fails loudly when a referenced kernel is missing', async () => {
    await expect(resolveLoadableKernels(fixture('broken.tm'))).rejects.toBeInstanceOf(PalError);
  });
});

describe('confineMetaKernelPath', () => {
  const root = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

  it('resolves a safe relative .tm under the root', () => {
    const resolved = confineMetaKernelPath('cassini.tm', root);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.replace(/\\/g, '/')).toMatch(/__fixtures__\/cassini\.tm$/);
  });

  it.each(['/etc/passwd', `..${sep}..${sep}secret.tm`, `sub${sep}..${sep}..${sep}escape.tm`])(
    'rejects an absolute or escaping path: %s',
    (tmPath) => {
      expect(() => confineMetaKernelPath(tmPath, root)).toThrow(PalError);
    },
  );
});
