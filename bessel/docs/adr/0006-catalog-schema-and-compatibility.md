# ADR-0006: Catalog schema and Cosmographia compatibility

Status: Accepted (carried forward and extended from prior Bessel design)
Date: 2026-06-07

## Context

Cosmographia's JSON catalog format is well-specified and stable, but its model
produces a per-sensor-per-target file explosion that makes mission setup brittle.
Missions have existing Cosmographia catalogs and cannot be asked to rewrite them
to adopt Bessel. Prior work identified an undocumented colorScheme and
colorByDistance slot that maps naturally to a color strategy system.

## Decision

The native schema is a single manifest expressed as JSON Schema Draft 2020-12,
checked into packages/catalog/schema/bessel-catalog.schema.json with a
Cassini-style reference instance under examples/. The design is documented in
docs/catalog-schema.md. The concrete decisions:

- Single manifest. One file with kernels, bodies, spacecraft, instruments, and
  observations arrays replaces Cosmographia's multi-file catalog system. The top
  level requires only version, so partial manifests compose.
- Parse the full Cosmographia geometry taxonomy (Mesh, DSK, Globe, Rings,
  ParticleSystem, KeplerianSwarm, TimeSwitched) as a discriminated union, each
  variant carrying a const type. geometryTimeSwitched references geometry
  recursively.
- Collapse the per-sensor-per-target file explosion: an instrument carries a
  targets array, so one sensor declaration covers every target it points at.
- Spacecraft single-arc (trajectory) and multi-arc (arcs) are mutually exclusive,
  enforced with oneOf plus not. This catches partial-arc-with-top-level-trajectory
  mistakes. The loader wraps the cryptic validator error with a friendlier
  diagnostic.
- colorByDistance is explicit nullable where used (oneOf [null, colorByDistance]),
  so a converter emits colorByDistance: null rather than an absent field, making
  it obvious the field was handled.
- mass accepts both forms: a string ("2523.0 kg") for Cosmographia round-trip and
  an object ({value, unit}) as the Bessel-preferred shape.
- arc is preserved verbatim as the cleanest part of Cosmographia's data model.
- observation carries an optional products array ({ id, type, href? }) linking
  an observation to the image or data products it produced, for downstream
  viewers and archives.
- sideDivisions has a floor of 2; Cosmographia crashes at 1, so the schema turns
  that crash into a validation error.
- colorScheme and colorByDistance.strategy are the integration seam for the color
  strategy system in @bessel/color. The strategy enum is a generic, extensible
  set of named color strategies; add strategies as needed.
- Provide a round-trip compatibility layer: Cosmographia in, native out, native
  back to Cosmographia on the lossless subset.
- Validate against the schema and emit explicit, located, typed errors on bad
  references (the loud-failure principle; never silently re-center).
- Compatibility target for v1: 80 percent core fidelity with a documented
  compatibility matrix, pursuing full fidelity opportunistically.

The schema is validated to the same gates as the original design: it passes
2020-12 meta-validation, the Cassini-style instance validates clean, and two
negative cases (a spacecraft with both arcs and trajectory; sideDivisions 1) are
rejected. Those two negative cases are wired into the Phase 1 acceptance criteria.

## Consequences

- Missions can migrate incrementally; existing catalogs load on day one.
- The single collapsed manifest is the recommended authoring format going forward.
- A documented compatibility matrix sets expectations about what is and is not
  preserved on round trip.
- Color strategies (distance, phase angle, parameter value to ramp) have a defined
  home and a Cosmographia-compatible entry point.
- The schema artifact is a fixed input to feature goals; the two validated negative
  cases give the catalog package an objective, /goal-verifiable correctness floor.
- Three items are deferred (geometryGlobe.atmosphere, the plugin manifest schema,
  and the agent and skill tool-binding schema); see docs/catalog-schema.md.
