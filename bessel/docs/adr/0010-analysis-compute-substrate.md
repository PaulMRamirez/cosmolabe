# ADR-0010: Analysis compute substrate (expanded SPICE surface, worker pool, evaluator)

Status: Accepted
Date: 2026-06-19

Supersedes the "minimal function surface" clause of ADR-0004; the rest of ADR-0004
stands.

## Context

ADR-0004 deliberately exposed only the minimal CSPICE function surface the renderer
needed (kernel management, time, spkpos/spkezr, pxform/sxform, getfov, bodvrd,
sincpt, subpnt, ilumin) over a single Web Worker. The mission-analysis engine layer
(docs/STK_PARITY_SPEC.md) needs more: the geometry finders and occultation, two-body
and element conversion, attitude and rotation utilities, SPK writing, and geodetic
and local-time functions. It also needs to evaluate quantities over thousands of
epochs without saturating the worker message channel, to cancel long sweeps, and to
use more than one core. The single-call, single-worker model cannot meet that.

## Decision

1. Expand the CSPICE export and binding surface beyond the renderer minimum to the
   analysis functions the engines call (the `gf*` finders, `occult`, `prop2b`/
   `conics`/`oscelt`, `twovec`/`m2q`/`q2m`/`raxisa`, `spkw13`, `recgeo`, `et2lst`,
   `illumf`, and related), each added through the same six-layer binding pattern
   (export, bindings, protocol, dispatch, client/pool, engine interface).
2. Add the F3 compute substrate in `@bessel/spice`:
   - an EvalSpec time-series interpreter that evaluates a declarative spec (a time
     grid plus unit-tagged providers from a `PROVIDER_CATALOG`) in one worker
     round-trip, returning column arrays transferred zero-copy;
   - a cancellable-job protocol (a job can be aborted mid-flight by a cancel
     message, which the interpreter observes at periodic yields);
   - a multi-worker pool that broadcasts kernel-state mutations to every worker and
     round-robins reads, and can partition a sweep across workers.
   The `SpiceWindow` interval algebra and the shared zero-crossing geometry finder
   live in `@bessel/timeline`.
3. Keep the existing mandates: all of this stays in the worker layer; the engine
   never reads kernel bytes (kernels arrive through the PAL KernelSource, ADR-0005);
   heavy compute never runs on the main thread.

## Consequences

- The SPICE surface is now analysis-complete rather than renderer-minimal; the
  guiding rule for what to export changes from "what the renderer needs" to "what a
  bound, tested engine calls." ADR-0004's core decisions (CSPICE-WASM in a worker,
  kernels via PAL, the correctness fixture) are unchanged.
- The 4 MB WASM budget is re-measured after each relink (`pnpm size`); the export
  list is trimmed to exactly the bound functions.
- Heavy, cancellable, parallel sweeps (coverage grids, conjunction screening,
  porkchop, propagation) become feasible without blocking the UI, and a runaway job
  can be aborted.
- We maintain a larger binding surface and the worker-pool and job machinery.
