# M-0006: License and governance mechanics

Status: Accepted
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: no; substance agreed 2026-07-09

## Context
Two authors, one merged codebase, an eventual institutional home. See docs/design/01 section 7 and docs/collab/mandate.md for the delegation under which solo execution proceeds.

## Decision
Apache-2.0 throughout (both parents already carry it). DCO now; CLA revisited only if the project moves under a foundation. CODEOWNERS maps to prior authorship: core and rendering to Aaron, spice, frames, engines, PAL, and interop to Paul; during the leave, Paul merges into Aaron-owned paths only behind green harness and baseline gates, with `review-on-return` tags on anything Class B (see docs/design/solo plan, decision classes). ADR discipline is unbroken: merge decisions are M-numbered, provisional ones carry the tag, and history-preserving subtree merges keep both parents' logs intact. Home is PaulMRamirez for now with NASA-AMMOS or a neutral foundation as the deliberate later destination.

## Consequences
Aaron's re-entry agenda is generated from the tag: provisional ADRs plus baseline diffs in his paths.
