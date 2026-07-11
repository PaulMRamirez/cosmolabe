// Capacitor KernelSource over the native filesystem, plus zip bundle import.
// Runs on-device (iOS); kernel bytes reach the SPICE engine through this source.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { unzipSync } from 'fflate';
import { PalError, type KernelHandle, type KernelSource } from '@bessel/pal';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Reject a kernel leaf name that could escape its directory: a `..` segment, a leading
 * slash, or any path separator. Fails loudly so a forged name cannot read or write
 * outside the kernel dir.
 */
function assertSafeLeaf(name: string, location: string): void {
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((seg) => seg === '..')
  ) {
    throw new PalError(`refusing an unsafe kernel name "${name}"`, 'kernel-not-found', location);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export class CapacitorKernelSource implements KernelSource {
  constructor(
    private readonly dir: string,
    private readonly directory: Directory = Directory.Data,
  ) {}

  private path(name: string): string {
    assertSafeLeaf(name, `CapacitorKernelSource.path(${name})`);
    return `${this.dir}/${name}`;
  }

  /** Re-validate a handle id is `${dir}/<safe-leaf>` so a forged handle cannot escape. */
  private confineHandleId(id: string): string {
    const prefix = `${this.dir}/`;
    const location = `CapacitorKernelSource.read(${id})`;
    if (!id.startsWith(prefix)) {
      throw new PalError(`refusing a kernel path outside ${this.dir}: "${id}"`, 'read-failed', location);
    }
    assertSafeLeaf(id.slice(prefix.length), location);
    return id;
  }

  async list(): Promise<KernelHandle[]> {
    const res = await Filesystem.readdir({ path: this.dir, directory: this.directory });
    return res.files.map((f) => ({ id: this.path(f.name), name: f.name }));
  }

  async resolve(name: string): Promise<KernelHandle> {
    try {
      const info = await Filesystem.stat({ path: this.path(name), directory: this.directory });
      return { id: this.path(name), name, size: info.size };
    } catch {
      throw new PalError(
        `Kernel "${name}" was not found in ${this.dir}`,
        'kernel-not-found',
        `CapacitorKernelSource.resolve(${name})`,
      );
    }
  }

  async read(handle: KernelHandle): Promise<Uint8Array> {
    const path = this.confineHandleId(handle.id);
    const res = await Filesystem.readFile({ path, directory: this.directory });
    if (typeof res.data !== 'string') {
      return new Uint8Array(await res.data.arrayBuffer());
    }
    return base64ToBytes(res.data);
  }
}

/** Import a kernel zip bundle into the app's kernel directory. Returns the paths. */
export async function importKernelZip(
  zipBytes: Uint8Array,
  destDir: string,
  directory: Directory = Directory.Data,
): Promise<string[]> {
  const entries = unzipSync(zipBytes);
  const written: string[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const leaf = name.split('/').pop() ?? name;
    assertSafeLeaf(leaf, `importKernelZip(${name})`);
    const path = `${destDir}/${leaf}`;
    await Filesystem.writeFile({ path, directory, data: bytesToBase64(bytes) });
    written.push(path);
  }
  return written;
}
