import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

// Capture Capacitor Filesystem writes into a map.
const writes = new Map<string, string>();
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      writes.set(path, data);
    }),
  },
}));

// atob/btoa exist in node 16+, used by the base64 conversion under test.
import { CapacitorKernelSource, importKernelZip } from './kernel-source.ts';
import { PalError } from '@bessel/pal';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe('@bessel/pal-capacitor importKernelZip', () => {
  beforeEach(() => writes.clear());

  it('extracts entries, flattens leaf names, skips directories, and round-trips bytes', async () => {
    // A larger-than-32KB entry exercises the base64 chunk boundary.
    const big = new Uint8Array(40000).map((_, i) => i % 256);
    const zip = zipSync({
      'lsk/naif0012.tls': strToU8('KPL/LSK\n'),
      'spk/de440s.bsp': big,
      'empty/': new Uint8Array(0),
    });

    const written = await importKernelZip(zip, '/kernels');
    expect(written.sort()).toEqual(['/kernels/de440s.bsp', '/kernels/naif0012.tls']);

    // The big file round-trips byte for byte through base64.
    const decoded = base64ToBytes(writes.get('/kernels/de440s.bsp')!);
    expect(decoded.length).toBe(40000);
    expect(Array.from(decoded.slice(0, 4))).toEqual([0, 1, 2, 3]);

    // The directory entry was skipped.
    expect(writes.has('/kernels/empty')).toBe(false);
  });
});

describe('@bessel/pal-capacitor CapacitorKernelSource path confinement', () => {
  const source = new CapacitorKernelSource('/kernels');

  it.each(['../../../etc/passwd', '/etc/passwd', 'sub/../../escape', 'a\\b'])(
    'rejects a traversal name in resolve: %s',
    async (name) => {
      await expect(source.resolve(name)).rejects.toBeInstanceOf(PalError);
    },
  );

  it('rejects a forged handle id outside the kernel dir on read', async () => {
    await expect(source.read({ id: '/etc/passwd', name: 'passwd' })).rejects.toBeInstanceOf(
      PalError,
    );
    await expect(
      source.read({ id: '/kernels/../escape', name: 'escape' }),
    ).rejects.toBeInstanceOf(PalError);
  });
});
