# ADR-0007: Mission plugin architecture

Status: Accepted
Date: 2026-06-07

## Context

Missions need to add their own kernels, frames, catalog overlays, custom panels,
and color strategies without forking Bessel. Cosmographia's JUICE ESA plugin
demonstrates that a mission-specific extension module is a viable and proven
pattern.

## Decision

Define a mission plugin surface (general availability in Phase 4, designed for
from the start):

- A declarative manifest per plugin: mission id, kernels to furnish, frames to
  register, catalog overlays, custom UI panels, and color strategies.
- A registry that discovers and lazily loads plugins, so the core stays small and
  a mission only pays for what it uses.
- Plugins consume the same core APIs and the PAL interface; they never reach into
  platform internals or break the dependency rule (CLAUDE.md).

## Consequences

- Mission-specific behavior ships as a module, mirroring the JUICE precedent,
  rather than as a fork.
- Lazy loading keeps the base bundle lean across all three targets.
- The plugin manifest is a stable contract; changes to it are themselves ADR-worthy.
- The color strategy seam (ADR-0006) is exposed to plugins, so missions can ship
  their own ramps and color strategies cleanly.
