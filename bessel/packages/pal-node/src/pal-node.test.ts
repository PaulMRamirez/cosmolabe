// The Node IO: a directory-backed kernel source resolves real fixtures, and the confined
// writer round-trips inside its output dir but refuses to escape it. (STK_PARITY_SPEC, SDK.)

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { PalError } from '@bessel/pal';
import { createNodeKernelSource, createNodeFileWriter, createNodeRunIo } from './index.ts';

const fixturesDir = fileURLToPath(new URL('../../../kernels/fixtures', import.meta.url));

describe('createNodeKernelSource', () => {
  it('resolves and reads a real fixture kernel', async () => {
    const src = createNodeKernelSource(fixturesDir);
    const handle = await src.resolve('naif0012.tls');
    expect(handle.name).toBe('naif0012.tls');
    const bytes = await src.read(handle);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('throws a located PalError for a missing kernel', async () => {
    const src = createNodeKernelSource(fixturesDir);
    await expect(src.resolve('nope.bsp')).rejects.toBeInstanceOf(PalError);
  });
});

describe('createNodeFileWriter', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bessel-pal-node-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back inside the output dir (nested path)', async () => {
    const write = createNodeFileWriter(dir);
    await write('sub/out.txt', new TextEncoder().encode('hello'));
    expect(new TextDecoder().decode(await readFile(join(dir, 'sub/out.txt')))).toBe('hello');
  });

  it('refuses to escape the output dir', async () => {
    const write = createNodeFileWriter(dir);
    await expect(write('../escape.txt', new Uint8Array())).rejects.toBeInstanceOf(PalError);
  });

  it('assembles a RunIo with kernels and writeFile', () => {
    const io = createNodeRunIo({ kernelDir: fixturesDir, outDir: dir });
    expect(typeof io.writeFile).toBe('function');
    expect(typeof io.kernels.resolve).toBe('function');
  });
});
