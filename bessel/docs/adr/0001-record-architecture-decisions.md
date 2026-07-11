# ADR-0001: Record architecture decisions

Status: Accepted
Date: 2026-06-07

## Context

Bessel carries forward decisions from prior design work and adds new ones for
the tri-target delivery substrate. The build is intended to run as autonomous,
checker-gated /goal sessions, which means decisions must be written down and
stable, not implicit in code that an agent might rewrite.

## Decision

We use Architecture Decision Records in the Nygard format (Status, Context,
Decision, Consequences), stored as numbered files in docs/adr/. Feature goals must
not modify ADRs; a decision changes only through a deliberate ADR edit or a new
superseding ADR.

## Consequences

- Decisions are auditable and survive autonomous edits.
- CLAUDE.md forbids editing docs/adr/ during feature goals, so the agent treats
  these as fixed inputs.
- New decisions append; reversals supersede rather than overwrite, preserving the
  reasoning trail.
