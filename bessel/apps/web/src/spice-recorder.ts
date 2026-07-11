// A thin recording wrapper around the main-thread SpiceComputeEngine that captures the
// kernel-state mutations (furnsh, the synthetic SPK Type-13 asset writes, unload, kclear)
// as an ordered, replayable op log. The dedicated coverage worker spawns its OWN SPICE
// worker (so the sweep's per-cell access geometry runs entirely off the main thread) and
// replays this log into it, reproducing the identical kernel pool: the base mission kernels
// plus every published Walker asset SPK. The geometry reads (spkpos, gfposc, ...) are NOT
// recorded; they are forwarded unchanged to the wrapped engine for the live scene, and the
// worker re-issues them against its own replayed pool. The log holds the bytes/states by
// reference (no copy) so wrapping is allocation-free on the hot read path.
//
// Why a wrapper, not call-site logging: there are only four kernel-mutating methods, but
// they are invoked from bootstrap, uploadKernel, and three asset-publish sites; intercepting
// at the engine boundary keeps one source of truth and cannot miss a future call site. The
// `as` at construction is the deliberate SDK seam (a typed handler delegates every other
// method to the inner engine), the only cast in this module.

import type { SpiceComputeEngine } from '@bessel/spice';

/** One replayable kernel-state mutation, in the order it was applied to the engine. */
export type KernelOp =
  | { readonly kind: 'furnsh'; readonly name: string; readonly bytes: Uint8Array }
  | {
      readonly kind: 'writeSpkType13';
      readonly name: string;
      readonly body: number;
      readonly center: number;
      readonly frame: string;
      readonly segid: string;
      readonly degree: number;
      readonly et: Float64Array;
      readonly states: Float64Array;
    }
  | { readonly kind: 'unload'; readonly name: string }
  | { readonly kind: 'kclear' };

/** The recorded kernel-op log, queryable for a replay snapshot. */
export interface KernelLog {
  /**
   * A snapshot of the ops needed to reconstruct the current kernel pool, in apply order.
   * A `kclear` truncates everything before it (the pool was wiped), and an `unload` drops the
   * matching earlier `furnsh`/`writeSpkType13` for that name, so the snapshot stays compact
   * and only ever contains live kernels. Returned by reference; callers must not mutate it.
   */
  snapshot(): readonly KernelOp[];
}

/** A SpiceComputeEngine wrapped with a kernel-op recorder: behaves identically to the inner
 *  engine and additionally exposes the replayable KernelLog. */
export interface RecordingSpiceEngine extends SpiceComputeEngine, KernelLog {}

/** Drop the earlier furnsh/writeSpkType13 op that loaded `name`, for an unload or a re-load. */
function withoutName(ops: KernelOp[], name: string): KernelOp[] {
  return ops.filter((op) => {
    if (op.kind === 'furnsh' || op.kind === 'writeSpkType13') return op.name !== name;
    return true;
  });
}

/**
 * Wrap a SpiceComputeEngine so its kernel-state mutations are recorded for replay. Reads pass
 * straight through. The returned engine is a drop-in for the original (same SpiceComputeEngine
 * surface) plus `snapshot()`. The handler delegates any non-intercepted property to the inner
 * engine, so the wrapper survives interface additions without re-declaring every method.
 */
export function recordKernelOps(inner: SpiceComputeEngine): RecordingSpiceEngine {
  let ops: KernelOp[] = [];

  const snapshot = (): readonly KernelOp[] => ops;

  const furnsh = async (name: string, bytes: Uint8Array): Promise<void> => {
    await inner.furnsh(name, bytes);
    ops = withoutName(ops, name).concat({ kind: 'furnsh', name, bytes });
  };

  const writeSpkType13 = async (
    name: string,
    body: number,
    center: number,
    frame: string,
    segid: string,
    degree: number,
    et: Float64Array,
    states: Float64Array,
  ): Promise<void> => {
    await inner.writeSpkType13(name, body, center, frame, segid, degree, et, states);
    ops = withoutName(ops, name).concat({
      kind: 'writeSpkType13',
      name,
      body,
      center,
      frame,
      segid,
      degree,
      et,
      states,
    });
  };

  const unload = async (name: string): Promise<void> => {
    await inner.unload(name);
    ops = withoutName(ops, name).concat({ kind: 'unload', name });
  };

  const kclear = async (): Promise<void> => {
    await inner.kclear();
    // A wipe makes every prior op moot; the replayed pool only needs the clear marker.
    ops = [{ kind: 'kclear' }];
  };

  // A typed handler that intercepts the four mutators and the snapshot accessor, delegating
  // every other property (the geometry reads, evalSeries, ...) to the inner engine unchanged.
  const handler: ProxyHandler<SpiceComputeEngine> = {
    get(target, prop, receiver): unknown {
      switch (prop) {
        case 'snapshot':
          return snapshot;
        case 'furnsh':
          return furnsh;
        case 'writeSpkType13':
          return writeSpkType13;
        case 'unload':
          return unload;
        case 'kclear':
          return kclear;
        default: {
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        }
      }
    },
  };

  return new Proxy(inner, handler) as RecordingSpiceEngine;
}
