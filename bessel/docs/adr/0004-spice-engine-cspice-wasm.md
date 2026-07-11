# ADR-0004: CSPICE compiled to WebAssembly, isolated in a Web Worker

Status: Accepted (carried forward from prior Bessel design)
Date: 2026-06-07

## Context

Bessel must compute real SPICE geometry (positions, frames, fields of view,
surface intercepts) in the browser, on mobile, and on the desktop. Reimplementing
SPICE math is out of the question; NAIF CSPICE is the source of truth. Prior art
(arturania/cspice) already compiles CSPICE to WebAssembly with a Web Worker
integration pattern.

## Decision

Build @bessel/spice as a typed, promise-based wrapper over a CSPICE-WASM build
forked from arturania/cspice and updated to a current CSPICE toolkit version. Run
the WASM module in a dedicated Web Worker so the main thread never blocks on
furnsh or geometry calls. Expose only the minimal function surface the renderer
needs (kernel management, time conversions, spkpos and spkezr, pxform and sxform,
getfov, bodvrd and bodvcd, sincpt, subpnt, ilumin).

The engine never reads kernel bytes directly; kernels arrive through the PAL
KernelSource (ADR-0005).

## Consequences

- The hardest technical risk (SPICE in the browser) is retired by reuse, not
  invention.
- The same engine works across all three targets because kernel transport is
  abstracted away from it.
- A correctness fixture (spkpos of a known body at a known epoch, compared to a
  NAIF reference within tolerance) gives Phase 0 an objective finish line.
- We take on maintenance of a CSPICE-WASM fork and the typed API surface.
