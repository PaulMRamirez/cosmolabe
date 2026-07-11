// Node filesystem KernelSource for the Electron target. In production it runs in
// the main process (or behind the typed IPC bridge); kernel bytes reach the SPICE
// engine through this source, never read by the engine directly.

import { readFile, open, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';

// A range read may not exceed this many bytes in one call (64 MiB). Guards against a
// renderer-controlled length allocating an absurd buffer.
const MAX_RANGE_BYTES = 64 * 1024 * 1024;

export class NodeKernelSource implements KernelSource {
  private readonly root: string;

  constructor(baseDir: string) {
    this.root = resolve(baseDir);
  }

  /** Assert `target` (an absolute path) stays under the root; throw if it escapes. */
  private assertUnderRoot(target: string, name: string, code: 'kernel-not-found' | 'read-failed', location: string): void {
    const rel = relative(this.root, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PalError(
        `refusing a kernel path that escapes ${this.root}: "${name}"`,
        code,
        location,
      );
    }
  }

  /**
   * Resolve a caller-supplied name to an absolute path confined to the base dir. An
   * absolute name or one that escapes the root via `..` fails loudly rather than
   * reading outside the kernel directory (mirrors createNodeFileWriter containment).
   */
  private confineName(name: string, location: string): string {
    if (isAbsolute(name)) {
      throw new PalError(
        `refusing an absolute kernel path "${name}"`,
        'kernel-not-found',
        location,
      );
    }
    const target = resolve(this.root, name);
    this.assertUnderRoot(target, name, 'kernel-not-found', location);
    return target;
  }

  /**
   * Re-validate a handle id (an absolute path produced by resolve/list) is still under
   * the base dir before a read, so a forged or tampered handle cannot escape the root.
   */
  private confineHandleId(id: string, location: string): string {
    const target = resolve(id);
    this.assertUnderRoot(target, id, 'read-failed', location);
    return target;
  }

  async list(): Promise<KernelHandle[]> {
    const entries = await readdir(this.root);
    return entries.map((name) => ({ id: join(this.root, name), name }));
  }

  async resolve(name: string): Promise<KernelHandle> {
    const path = this.confineName(name, `NodeKernelSource.resolve(${name})`);
    try {
      const info = await stat(path);
      return { id: path, name, size: info.size };
    } catch {
      throw new PalError(
        `Kernel "${name}" was not found under ${this.root}`,
        'kernel-not-found',
        `NodeKernelSource.resolve(${name})`,
      );
    }
  }

  async read(handle: KernelHandle): Promise<Uint8Array> {
    const path = this.confineHandleId(handle.id, `NodeKernelSource.read(${handle.name})`);
    try {
      return new Uint8Array(await readFile(path));
    } catch (err) {
      throw new PalError(
        `Failed to read kernel "${handle.name}": ${err instanceof Error ? err.message : String(err)}`,
        'read-failed',
        `NodeKernelSource.read(${handle.name})`,
      );
    }
  }

  async readRange(handle: KernelHandle, offset: number, length: number): Promise<Uint8Array> {
    const location = `NodeKernelSource.readRange(${handle.name})`;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new PalError(`invalid range offset ${offset}`, 'read-failed', location);
    }
    if (!Number.isInteger(length) || length < 0 || length > MAX_RANGE_BYTES) {
      throw new PalError(`invalid range length ${length}`, 'read-failed', location);
    }
    const path = this.confineHandleId(handle.id, location);
    try {
      const fd = await open(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await fd.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      } finally {
        await fd.close();
      }
    } catch (err) {
      if (err instanceof PalError) throw err;
      throw new PalError(
        `Failed range read for kernel "${handle.name}": ${err instanceof Error ? err.message : String(err)}`,
        'read-failed',
        location,
      );
    }
  }
}
