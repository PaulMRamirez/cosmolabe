# M-0002: Seam contracts and harness tolerance gates

Status: Accepted
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: no; substance agreed 2026-07-09. Any tolerance-gate change reopens this ADR and sets this field to yes.

## Context
Two independently evolved cores meet at one SPICE layer. Call-site counts understate the risk; the disagreements live in semantics (time scales, frame chaining, aberration defaults, units, caching, kernel lifecycle). See docs/design/01 section 3.1 and docs/design/02 section 2.

## Decision
The seam is two published contracts in the `frames` tier: `StateProvider` (batched states, `correction` explicit and required) and `FramesService` (single authority for epoch conversion and frame chains, inspectable, kernel set hashable). Nothing above `frames` calls CSPICE. A differential harness runs both cores' pipelines over golden scenarios GS-1 through GS-4 and gates the swap. Tolerances: call-parity mode, relative 1e-12; pipeline mode, 1 m position and 5 arcsec pointing, tripwires for semantic mismatch rather than physics claims. The harness graduates into the permanent conformance suite of the published cspice-wasm package.

## Consequences
The re-point becomes a measured migration. timecraftjs retires once pipeline mode is green on all four scenarios. Operational clarification (2026-07-10, Session 3; not a reopening, no tolerance changes): the frames tier ships cache-free, so pipeline mode currently measures cosmolabe's caching and interpolation against direct CSPICE; any caching layer later added to frames requires a pipeline-mode re-measurement before it merges.
