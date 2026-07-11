// Run provenance: a deterministic manifest of what a run consumed and produced. It
// records each furnished kernel's sha256 digest, every op's status, and every output
// file's sha256 digest, so a run is auditable and reproducible. canonicalJson serializes
// any JSON value with sorted keys for byte-stable artifacts (a report file, the manifest
// itself). Digests use Web Crypto crypto.subtle (Node 22). (STK_PARITY_SPEC, SDK.)

import type { OpRecord } from './run.ts';

export interface KernelDigest {
  readonly name: string;
  readonly bytes: number;
  /** Lowercase hex sha256 of the kernel bytes. */
  readonly sha256: string;
}

export interface OutputDigest {
  readonly path: string;
  readonly bytes: number;
  /** Lowercase hex sha256 of the output bytes. */
  readonly sha256: string;
}

export interface RunManifest {
  readonly besselBatch: '1';
  /** Furnished kernels, in furnish order, with their digests. */
  readonly kernels: readonly KernelDigest[];
  /** Per-op status records (the same shape RunResult carries). */
  readonly ops: readonly Pick<OpRecord, 'index' | 'op' | 'id' | 'status'>[];
  /** Written artifacts, in write order, with their digests. */
  readonly outputs: readonly OutputDigest[];
}

/** Lowercase hex sha256 of the bytes, via Web Crypto (deterministic, no Node imports). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  const out = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < out.length; i++) hex += out[i]!.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Serialize a JSON value with object keys sorted lexicographically at every depth, so
 * the same logical value always yields the same bytes (the report and manifest are
 * byte-stable across runs). Arrays keep their order. `indent` defaults to 2.
 */
export function canonicalJson(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}
