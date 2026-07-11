// Meta-kernel (.tm) path resolution for desktop parity with Cosmographia (SPEC
// Phase 3). A .tm lists PATH_VALUES and PATH_SYMBOLS plus KERNELS_TO_LOAD with
// $SYMBOL references; this resolves those into absolute, loadable kernel paths,
// relative entries resolving against the meta-kernel's own directory.

import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PalError } from '@bessel/pal';

/**
 * Confine a caller-supplied meta-kernel path to `root`. An absolute path or one that
 * escapes the root via `..` fails loudly rather than letting the renderer read an
 * arbitrary `.tm` from anywhere on disk.
 */
export function confineMetaKernelPath(tmPath: string, root: string): string {
  const base = resolve(root);
  if (isAbsolute(tmPath)) {
    throw new PalError(`refusing an absolute meta-kernel path "${tmPath}"`, 'kernel-not-found', 'confineMetaKernelPath');
  }
  const target = resolve(base, tmPath);
  const rel = relative(base, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PalError(`refusing a meta-kernel path that escapes ${base}: "${tmPath}"`, 'kernel-not-found', 'confineMetaKernelPath');
  }
  return target;
}

/** Extract the quoted string list assigned to NAME inside the data block. SPICE
 *  continues a long string across entries with a '+' token between quotes. */
function parseList(dataBlock: string, name: string): string[] {
  const re = new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`, 'i');
  const match = re.exec(dataBlock);
  if (!match) return [];
  const out: string[] = [];
  let acc: string | null = null;
  let continued = false;
  for (const tok of match[1]!.matchAll(/'((?:[^']|'')*)'|(\+)/g)) {
    if (tok[2] === '+') {
      continued = true;
      continue;
    }
    const value = tok[1]!.replace(/''/g, "'");
    if (continued && acc !== null) {
      acc += value;
      continued = false;
    } else {
      if (acc !== null) out.push(acc);
      acc = value;
    }
  }
  if (acc !== null) out.push(acc);
  return out;
}

export interface MetaKernel {
  readonly path: string;
  readonly kernels: readonly string[];
}

/**
 * Parse a meta-kernel and return absolute kernel paths. Symbols in PATH_SYMBOLS
 * are substituted with PATH_VALUES; relative results resolve against the .tm dir.
 */
export async function resolveMetaKernel(tmPath: string): Promise<MetaKernel> {
  let text: string;
  try {
    text = await readFile(tmPath, 'utf8');
  } catch {
    throw new PalError(`Meta-kernel not found: ${tmPath}`, 'kernel-not-found', tmPath);
  }
  const baseDir = dirname(tmPath);

  // Only the \begindata block carries assignments.
  const dataMatch = /\\begindata([\s\S]*?)(?:\\begintext|$)/i.exec(text);
  const data = dataMatch ? dataMatch[1]! : text;

  const values = parseList(data, 'PATH_VALUES');
  const symbols = parseList(data, 'PATH_SYMBOLS');
  const toLoad = parseList(data, 'KERNELS_TO_LOAD');

  const symbolMap = new Map<string, string>();
  symbols.forEach((sym, i) => symbolMap.set(sym, values[i] ?? ''));

  const kernels = toLoad.map((entry) => {
    const substituted = entry.replace(/\$([A-Za-z0-9_]+)/g, (_, sym: string) => symbolMap.get(sym) ?? `$${sym}`);
    return isAbsolute(substituted) ? substituted : resolve(baseDir, substituted);
  });

  return { path: tmPath, kernels };
}

/** Resolve a meta-kernel and assert every referenced kernel exists (loadable). */
export async function resolveLoadableKernels(tmPath: string): Promise<string[]> {
  const meta = await resolveMetaKernel(tmPath);
  for (const kernel of meta.kernels) {
    try {
      await stat(kernel);
    } catch {
      throw new PalError(
        `Meta-kernel ${tmPath} references a missing kernel: ${kernel}`,
        'kernel-not-found',
        kernel,
      );
    }
  }
  return [...meta.kernels];
}
