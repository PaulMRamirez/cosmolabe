import { describe, it, expect } from 'vitest';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kernelSourceContract } from '@bessel/pal/testing';
import { PalError } from '@bessel/pal';
import { NodeKernelSource } from './node.ts';

const fixturesDir = fileURLToPath(new URL('../../../kernels/fixtures/', import.meta.url));

kernelSourceContract('pal-electron NodeKernelSource', () => ({
  source: new NodeKernelSource(fixturesDir),
  presentName: 'naif0012.tls',
  missingName: 'does-not-exist.bsp',
}));

describe('NodeKernelSource path confinement', () => {
  const source = new NodeKernelSource(fixturesDir);

  it.each([
    `..${sep}..${sep}..${sep}etc${sep}passwd`,
    '/etc/passwd',
    `subdir${sep}..${sep}..${sep}..${sep}secret`,
  ])('rejects a traversal name in resolve: %s', async (name) => {
    await expect(source.resolve(name)).rejects.toBeInstanceOf(PalError);
    await expect(source.resolve(name)).rejects.toMatchObject({ code: 'kernel-not-found' });
  });

  it('rejects a read whose handle id escapes the base dir', async () => {
    const forged = { id: join(fixturesDir, '..', '..', 'package.json'), name: 'escape' };
    await expect(source.read(forged)).rejects.toBeInstanceOf(PalError);
    await expect(source.read(forged)).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('rejects an absolute handle id outside the base dir on readRange', async () => {
    const forged = { id: '/etc/passwd', name: 'passwd' };
    await expect(source.readRange(forged, 0, 16)).rejects.toBeInstanceOf(PalError);
    await expect(source.readRange(forged, 0, 16)).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('validates readRange bounds (negative offset, negative length, oversized length)', async () => {
    const handle = await source.resolve('naif0012.tls');
    await expect(source.readRange(handle, -1, 8)).rejects.toMatchObject({ code: 'read-failed' });
    await expect(source.readRange(handle, 0, -8)).rejects.toMatchObject({ code: 'read-failed' });
    await expect(source.readRange(handle, 0, 64 * 1024 * 1024 + 1)).rejects.toMatchObject({
      code: 'read-failed',
    });
    await expect(source.readRange(handle, 0, Number.NaN)).rejects.toMatchObject({
      code: 'read-failed',
    });
  });

  it('reads a valid in-bounds range', async () => {
    const handle = await source.resolve('naif0012.tls');
    const bytes = await source.readRange(handle, 0, 8);
    expect(bytes.byteLength).toBe(8);
  });
});
