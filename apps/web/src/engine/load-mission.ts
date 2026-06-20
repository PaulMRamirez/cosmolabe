// The mission-load orchestration extracted from the engine class so it is pure and
// unit-testable without a canvas or a live SPICE worker. It mirrors a Cosmographia
// add-on load: furnish each declared kernel exactly once, in SPICE-data-before-
// objects order, then verify the declared frames resolve, all BEFORE the catalog
// renders. Every step fails loudly (CLAUDE.md: typed, located errors, no silent
// fallback). The engine supplies the side-effecting resolve/furnish/verify hooks.

import type { KernelRef } from '@bessel/catalog';

export interface FurnishHooks {
  /** Resolve a kernel ref's bytes through the PAL KernelSource (loud on miss). */
  readonly resolve: (ref: KernelRef) => Promise<Uint8Array>;
  /** Furnish one kernel's bytes into SPICE (de-duplicated by the caller). */
  readonly furnish: (name: string, bytes: Uint8Array) => Promise<void>;
  /** True when a logical name was already furnished this session. */
  readonly isFurnished: (name: string) => boolean;
  /** Verify a SPICE frame resolves now its kernels are furnished (loud on miss). */
  readonly verifyFrame: (frame: string) => Promise<void>;
}

/**
 * Furnish a plugin's kernels in declaration order, skipping names already
 * furnished, then verify each declared frame resolves. Returns the kernel names
 * furnished by this call, in order, so the engine (and tests) can assert that
 * SPICE data was loaded before the objects that depend on it.
 */
export async function furnishMissionKernels(
  kernels: readonly KernelRef[],
  frames: readonly string[],
  hooks: FurnishHooks,
): Promise<string[]> {
  const furnished: string[] = [];
  for (const ref of kernels) {
    if (hooks.isFurnished(ref.name)) continue;
    const bytes = await hooks.resolve(ref);
    await hooks.furnish(ref.name, bytes);
    furnished.push(ref.name);
  }
  for (const frame of frames) {
    await hooks.verifyFrame(frame);
  }
  return furnished;
}
