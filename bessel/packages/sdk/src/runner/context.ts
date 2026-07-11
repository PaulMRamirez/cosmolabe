// Shared shapes for the runner: the PAL seam (RunIo) the shell injects, and the per-op
// execution context threaded to every op executor. (STK_PARITY_SPEC, SDK.)

import type { KernelSource } from '@bessel/pal';
import type { SpiceEngine } from '@bessel/spice';
import type { MissionEnv } from '@bessel/propagator';
import type { EntityDecl } from '../job/types.ts';
import type { OpResult } from './results.ts';

/** The platform seam: kernel bytes in, artifact bytes out. A shell supplies a Node PAL. */
export interface RunIo {
  readonly kernels: KernelSource;
  /** Write an artifact (path relative to the job's output dir). */
  writeFile(relPath: string, data: Uint8Array): Promise<void>;
  /** Read a text input (e.g. a catalog). Optional: a job that uses loadCatalog needs it. */
  readText?(relPath: string): Promise<string>;
}

export interface ResolvedDefaults {
  readonly frame: string;
  readonly center: string;
}

export interface OpContext {
  readonly engine: SpiceEngine;
  readonly io: RunIo;
  readonly registry: ReadonlyMap<string, OpResult>;
  readonly entities: ReadonlyMap<string, EntityDecl>;
  readonly defaults: ResolvedDefaults;
  readonly env: MissionEnv;
  readonly signal?: AbortSignal;
}
