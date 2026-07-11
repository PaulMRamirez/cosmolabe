// The runner's provenance tape: the raw (name -> bytes) records the runner captures while
// executing (furnished kernels and written artifacts), and the reduction that digests them
// into the RunManifest returned on RunResult. Kept separate from run.ts so the recording
// seam and the hashing stay single-responsibility. (STK_PARITY_SPEC, SDK.)

import { sha256Hex, type RunManifest } from './manifest.ts';
import type { OpRecord } from './run.ts';

export type { RunManifest } from './manifest.ts';

/** Captured-but-undigested run inputs and outputs, in observation order. */
export interface ProvenanceTape {
  readonly kernels: { readonly name: string; readonly bytes: Uint8Array }[];
  readonly outputs: { readonly path: string; readonly bytes: Uint8Array }[];
}

/** Digest the tape and op records into the manifest returned on the run result. */
export async function buildManifest(records: readonly OpRecord[], tape: ProvenanceTape): Promise<RunManifest> {
  const kernels = await Promise.all(
    tape.kernels.map(async (k) => ({ name: k.name, bytes: k.bytes.byteLength, sha256: await sha256Hex(k.bytes) })),
  );
  const outputs = await Promise.all(
    tape.outputs.map(async (o) => ({ path: o.path, bytes: o.bytes.byteLength, sha256: await sha256Hex(o.bytes) })),
  );
  return {
    besselBatch: '1',
    kernels,
    ops: records.map((r) => ({ index: r.index, op: r.op, id: r.id, status: r.status })),
    outputs,
  };
}
