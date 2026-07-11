# Bessel Catalog Schema Design

Status: v1.0, implemented and tested in packages/catalog
Date: 2026-06-19
Artifacts: packages/catalog/schema/bessel-catalog.schema.json,
packages/catalog/schema/examples/cassini-saturn.example.json
Decision record: docs/adr/0006-catalog-schema-and-compatibility.md

This document describes the native Bessel catalog schema and the reasoning
behind it. The schema is a single-manifest replacement for Cosmographia's
multi-file catalog system. It is expressed as JSON Schema Draft 2020-12 and is
validated programmatically (see "Validation" below).

Provenance note: this schema is re-derived from the design produced in the prior
Bessel schema conversation and reconciled with the tri-target specification. It
matches the original's 27 definitions and the original's validation gates. If the
original bessel-catalog-schema-design.md is available, reconcile field-level
text against it before locking; the functional contract here is equivalent.

---

## 1. From many files to one manifest

Cosmographia splits a mission across multiple catalog files: SPICE data,
spacecraft, sensor, observation, natural body, and catalog-list, plus annotations,
visualizers, surface features, and viewpoints. The most painful consequence is a
per-sensor-per-target file explosion: each sensor pointed at each target tends to
become its own file.

Bessel uses a single manifest with arrays:

- kernels (baseUrl, paths, metaKernels)
- bodies
- spacecraft
- instruments
- observations

The manifest top level requires only version, so partial manifests are valid and
composable. kernels.baseUrl is the value the PAL KernelSource consumes to locate
kernels per platform (ADR-0005).

---

## 2. The 27 definitions

The schema defines 27 reusable types in $defs:

arc, body, colorByDistance, cssColor, duration, geometry, geometryDSK,
geometryGlobe, geometryKeplerianSwarm, geometryMesh, geometryParticleSystem,
geometryRings, geometryTimeSwitched, id, instrument, interval, label, mass,
observation, orientation, quaternion, range, rate, spacecraft, timeRange,
trajectory, trajectoryPlot.

geometry is a discriminated union over the seven Cosmographia geometry types
(Mesh, DSK, Globe, Rings, ParticleSystem, KeplerianSwarm, TimeSwitched), each
carrying a const type so exactly one variant matches. geometryTimeSwitched
references geometry recursively for its segments.

---

## 3. Key design decisions

- Collapsed instruments. An instrument carries a targets array, so one sensor
  declaration covers every target it points at. This removes the per-sensor-per-target
  explosion.
- Spacecraft single-arc versus multi-arc are mutually exclusive. A spacecraft has
  either a single trajectory or an arcs array, enforced with oneOf plus not. This
  catches a real authoring mistake: partially specifying arcs while leaving a
  top-level trajectory in place. The raw oneOf error from a validator is cryptic,
  so the loader wraps it with a friendlier diagnostic (the loud-failure principle).
- colorByDistance is explicit nullable. Where used, it is oneOf [null,
  colorByDistance] rather than an omitted field. Cosmographia's default is off
  (showResWithColor false), and a converter wants to emit colorByDistance: null so
  it is obvious the converter handled the field rather than skipped it.
- mass accepts both forms. A string ("2523.0 kg", "95.159 Mearth") matches
  Cosmographia for round-trip; an object ({value, unit}) is the Bessel-preferred
  shape. The converter emits string form going to Cosmographia and object form
  staying in Bessel.
- arc is preserved verbatim. The arc pattern (a time-bounded segment binding a
  trajectory and orientation) is the cleanest part of Cosmographia's model and is
  carried over unchanged.
- sideDivisions has a floor of 2. Cosmographia crashes at sideDivisions 1, so the
  schema enforces minimum 2, turning a crash into a validation error.
- observation.products links observations to the image or data products they
  produced ({ id, type, href? }), for downstream viewers and archives.
- colorByDistance.strategy is the color-strategy extension point. The enum
  currently lists linear, log, histogram-equalize, percentile-clip, quantile,
  manual-breaks, diverging, categorical. These are a generic, extensible set; add
  strategies as needed.

---

## 4. Validation

The schema and the Cassini-style instance are validated by
scripts/validate-catalog-schema.py (Python jsonschema, Draft 2020-12), a
standalone re-check; the same gates are covered by Vitest in
packages/catalog/src (schema.test.ts and siblings). The gates are:

1. The schema validates against the JSON Schema 2020-12 meta-schema.
2. A full Cassini-style instance validates clean. The instance has Saturn (a globe
   with rings), Cassini (cruise and Saturn-orbit arcs), the ISS NAC instrument
   targeting both Saturn and Titan, and two observation intervals: one continuous
   swath and one discrete at 1 Hz.
3. Negative test A: a spacecraft with both arcs and trajectory is rejected.
4. Negative test B: sideDivisions 1 (the Cosmographia crash case) is rejected.

These two negative cases are covered by the catalog tests so the schema validation
is verifiable in `pnpm test`.

---

## 5. Deferred

Three items are intentionally not locked here:

- geometryGlobe.atmosphere. Cosmographia uses an atmosphere structure but does not
  formally document it; the schema keeps atmosphere permissive for now. Derive the
  formal structure from Cosmographia's earth-spice.json and similar, in Phase 3
  when atmosphere rendering lands.
- The plugin manifest schema. The plugin contract is owned by ADR-0007 and reaches
  general availability in Phase 4; its own $defs entry is added when that contract
  settles.
- The agent and skill tool-binding schema. This is downstream of the cross-platform
  skills work and is deliberately not locked into the catalog schema.

---

## 6. Compatibility posture

v1 targets 80 percent core fidelity with Cosmographia, with a documented
compatibility matrix, pursuing full fidelity opportunistically (ADR-0006). The
round-trip layer (Cosmographia in, native out, native back to Cosmographia on the
lossless subset) is the mechanism that lets missions adopt Bessel without
rewriting existing catalogs. The schema is locked and tested; a standalone
`fromCosmographia` converter is a noted gap (the loader parses Cosmographia
catalogs directly today via `apps/web/src/catalog-load.ts`).
