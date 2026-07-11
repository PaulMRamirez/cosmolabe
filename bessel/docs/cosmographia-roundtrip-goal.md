# Goal: Full bidirectional Cosmographia round-trip (import and export)

> Status: Planned, 2026-06-21. Style follows the phased-goal format. This goal is
> scoped to the catalog data model and the Cosmographia compatibility layer. It
> does not touch ADRs, SPEC.md, or CLAUDE.md (those change deliberately, not as a
> side effect). No em dashes anywhere (CLAUDE.md). The companion design is
> PARITY_MATRIX Section 16.

## Objective

Make Bessel a true Cosmographia peer for data: import any supported Cosmographia
catalog (all items: bodies, spacecraft, every trajectory type, every rotation
model, every geometry type, sensors, observations) into the **rendered** scene,
and export a native Bessel catalog **back** to Cosmographia, with a lossless
round-trip on the supported subset proven by a new test. Onboarding a Cosmographia
user must be "drop your catalog, see your mission, and get your catalog back."

## Scope

Items 1 through 5 of the Section 16 design plus the exporter and the round-trip
test:

1. Reconcile schema <-> TS trajectory/orientation type names (schema canonical).
2. TLE trajectory: model + wire `parseTle`/`sgp4`/`temeToJ2000AtEt`.
3. Keplerian + Fixed + Sampled trajectory params: model + wire
   `propagateMeanElements`/constant/interpolated sampling.
4. Full `fromCosmographia` importer (all items and types) wired into
   `catalog-load.ts` + `renderNativeMission`.
5. Honor `trajectoryPlot` + per-item `label`, and TwoVector orientation params.
6. `toCosmographia` exporter + lossless `cosmo -> native -> cosmo` round-trip test.

Out of scope: new geometry *renderers* (they exist), new SPICE exports, TLE
auto-update (niche, Section 15), atmosphere sub-field formalization (stays
permissive and passes through verbatim).

## Locked decisions

- **Schema is the source of truth.** On any schema/TS name conflict, the schema
  wins; TS is corrected to match (`Sampled` not `InterpolatedStates`, `Fixed` not
  `FixedPoint`).
- **Trajectory becomes a discriminated `oneOf` union** (per type), each
  `additionalProperties:false`. The stub is replaced, not extended in place.
- **Non-SPICE propagation lives in the app/scene seam, not core.** A new
  `apps/web/src/trajectory/*` calls `@bessel/propagator`; the core catalog package
  stays free of propagation logic (layering rule). `@bessel/propagator` already
  exports `propagateMeanElements`, `parseTle`, `sgp4init`, `sgp4`, and
  `temeToJ2000AtEt`; reuse them, do not reimplement Kepler/SGP4 math.
- **Sampled/Mesh sources go through the PAL**, never raw byte reads (KernelSource /
  FileSystem), so the same importer works on web, Electron, and Capacitor.
- **Loud failure preserved.** Bad references throw a located `CatalogError`; known
  lossy constructs emit a typed `CatalogWarning`, never a silent drop or re-center.
- **Importer output is schema-validated** (`parseBesselCatalog`) before it reaches
  the scene, so `fromCosmographia` cannot produce an invalid catalog.
- **`parseCosmographiaCatalog` (single-item) stays** for back-compat; the new
  `fromCosmographia` is the multi-item path.

## Phases

### Phase A: model reconciliation (items 1 + the type plumbing)
Replace the trajectory stub with the `oneOf` union and add `Tle`; correct the TS
`Trajectory`/`Orientation` unions; add `label`/`trajectoryPlot` to
`CatalogBody`/`CatalogSpacecraft` TS; add TwoVector params. Add the
schema<->TS cross-check test. Gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`
green, no new geometry/render code yet.

### Phase B: trajectory wiring (items 2 + 3)
Add `apps/web/src/trajectory/{index,tle,keplerian,sampled,fixed}.ts`. Implement
`sampleTrajectory(spice, pal, trajectory, etGrid, center)`. Route
`generic-mission.ts` through it so non-SPICE trajectories render. Unit-test each
sampler against a reference state. Gate: each new trajectory type renders a
non-empty polyline in a headless scene test.

### Phase C: importer (item 4)
Implement `fromCosmographia` (all items, all trajectory/rotation/geometry types,
sensors, observations, includes). Extend `cosmographiaGeometryToNative` to the
remaining five geometry types and add `cosmographiaTrajectoryToNative` and
`cosmographiaRotationToNative`. Wire `catalog-load.ts` to carry the imported
`catalog` so Cosmographia input reaches `renderNativeMission`. Gate: the multi-item
fixture imports and renders.

### Phase D: visual config + TwoVector resolution (item 5)
Honor `trajectoryPlot` (lead/trail/duration/sampleCount/color/fade) and per-item
`label` in `generic-mission.ts`; implement `resolveTwoVector` and feed the attitude
path. Gate: a fixture with a `trajectoryPlot` color and a `TwoVector` orientation
renders with the declared color and a correct basis.

### Phase E: exporter + round-trip (item 6)
Implement `toCosmographia` (inverse of `fromCosmographia` on the lossless subset)
with a `besselExtra` passthrough bag. Add the round-trip fixture, the round-trip
fidelity test, and the property test. Gate: round-trip identity on the subset; lossy
constructs emit `CatalogWarning`. Run full `pnpm verify`.

## Backlog

| id | priority | description | files | effort |
| --- | --- | --- | --- | --- |
| C1 | P0 | Replace trajectory stub with `oneOf` union; add `Tle`, `Keplerian.elements`, `Fixed.position`, `Sampled.source` | `packages/catalog/schema/bessel-catalog.schema.json` | M |
| C2 | P0 | Correct TS `Trajectory` union (`Sampled`/`Fixed`/`Tle`), add per-branch params | `packages/catalog/src/native-types.ts` | M |
| C3 | P0 | Add TwoVector `primary`/`secondary` params (schema + TS) | schema, `native-types.ts` | S |
| C4 | P0 | Add `label`/`trajectoryPlot` to `CatalogBody`/`CatalogSpacecraft` TS | `native-types.ts` | S |
| C5 | P0 | schema<->TS enum cross-check test | `packages/catalog/src/schema.test.ts` | S |
| C6 | P0 | `sampleTrajectory` dispatcher (switch on type, flat-table out) | `apps/web/src/trajectory/index.ts` (new) | M |
| C7 | P0 | TLE sampler: `parseTle`+`sgp4`+`temeToJ2000AtEt` | `apps/web/src/trajectory/tle.ts` (new) | M |
| C8 | P0 | Keplerian sampler: `propagateMeanElements`/`conics` adapter | `apps/web/src/trajectory/keplerian.ts` (new) | M |
| C9 | P1 | Fixed sampler (constant) + Sampled sampler (PAL fetch + interp) | `apps/web/src/trajectory/{fixed,sampled}.ts` (new) | M |
| C10 | P0 | Route `generic-mission.ts` spacecraft + body trajectory through `sampleTrajectory` | `apps/web/src/generic-mission.ts` | M |
| C11 | P0 | `cosmographiaTrajectoryToNative` (all 5 types) | `packages/catalog/src/cosmographia.ts` | M |
| C12 | P0 | `cosmographiaRotationToNative` (all 4 types incl. TwoVector) | `cosmographia.ts` | S |
| C13 | P1 | Extend `cosmographiaGeometryToNative` to Mesh/DSK/ParticleSystem/KeplerianSwarm/TimeSwitched | `cosmographia.ts` | M |
| C14 | P0 | `fromCosmographia` (all items, sensors, observations, includes, schema-validate) | `cosmographia.ts`, `index.ts` | L |
| C15 | P0 | Route Cosmographia input to `fromCosmographia` and carry `catalog` to render | `apps/web/src/catalog-load.ts` | S |
| C16 | P1 | Honor `trajectoryPlot` (lead/trail/duration/sampleCount/color/fade) | `generic-mission.ts` | M |
| C17 | P1 | Honor per-item `label` (text/color/show) | `generic-mission.ts` | S |
| C18 | P1 | `resolveTwoVector` basis -> quaternion attitude | `apps/web/src/trajectory/twovector.ts` (new), `generic-mission.ts` | M |
| C19 | P0 | `toCosmographia` exporter (inverse on lossless subset) + `besselExtra` passthrough | `cosmographia.ts` | L |
| C20 | P0 | `CatalogWarning` type for lossy constructs | `packages/catalog/src/index.ts` | S |
| C21 | P0 | Multi-item Cosmographia fixture | `packages/catalog/test/fixtures/cosmographia-multi.json` (new) | S |
| C22 | P0 | Round-trip fidelity test + property test | `packages/catalog/src/cosmographia-roundtrip.test.ts` (new) | M |
| C23 | P1 | e2e: drop the multi-item Cosmographia fixture, assert a non-empty WebGL frame | `e2e/tests/cosmographia-import.spec.ts` (new) | M |
| C24 | P2 | PARITY_MATRIX Section 2 row + scorecard delta; append Section 16 | `docs/PARITY_MATRIX.md` | S |

## Acceptance criteria

Tied to the existing gates plus the new round-trip tests:

1. **Every new trajectory type renders.** Headless scene tests show a non-empty
   polyline for `Spice`, `Keplerian`, `Tle`, `Fixed`, and `Sampled` trajectories
   (C6 through C10), each driven from catalog data, not hardcoded.
2. **Every orientation type resolves**, including `TwoVector` producing a correct
   orthonormal basis / quaternion (C12, C18), verified by a basis-orthonormality
   unit assertion.
3. **`fromCosmographia` imports a real multi-item fixture into the rendered scene**:
   the fixture (C21) with multiple bodies, a spacecraft, a non-Spice trajectory, a
   geometry, a rotation model, and an instrument loads via `catalog-load.ts` and the
   e2e (C23) asserts a non-empty WebGL frame (rendering asserted by test, never by
   judgement, per CLAUDE.md).
4. **`toCosmographia` exports it back** and the round-trip fidelity test (C22)
   passes: `canonicalize(toCosmographia(fromCosmographia(fixture)))` deep-equals
   `canonicalize(fixture)` on the lossless subset, and the property test shows
   `fromCosmographia(toCosmographia(x))` is identity for native catalogs `x` over
   the lossless grammar.
5. **Lossy constructs are loud.** A negative test asserts a known-lossy construct
   emits a typed `CatalogWarning`; no silent drop, no silent re-center.
6. **`pnpm verify` stays green** with the new tests: `typecheck`, `lint` (zero
   warnings, no new `ts-ignore`/`eslint-disable`/skipped tests), `test` (count rises,
   never drops below the current baseline of 943), `build:web`, and `size` (no shell
   budget growth: any new heavy code stays behind a dynamic-import boundary in the
   lazy bundle; `.size-limit.json` is not edited). `e2e` includes the new
   Cosmographia-import spec.
7. **The PARITY_MATRIX Section 2 catalog row flips toward Done**: row 1 Partial ->
   Done, scorecard `2. Catalog and data model` from `3 Done / 1 Partial` to
   `4 Done / 0 Partial`, with the round-trip test as evidence (C24), and Section 16
   appended.

## Risks

- **Keplerian frame/center mismatch.** `propagateMeanElements` returns states in a
  given `frame` about an implicit center; the catalog `center` must be honored so the
  polyline draws in the right basis. Mitigation: pass `center`/`frame` explicitly and
  test the Keplerian sampler against a known SPICE state for a circular orbit.
- **TEME->J2000 EOP inputs.** `temeToJ2000AtEt` is EOP-aware; with no EOP loaded it
  must degrade to a documented zero-EOP transform, not throw. Mitigation: default
  `EarthOrientation` to zeros and note the sub-arcsecond error in the test.
- **Round-trip canonicalization scope creep.** Over-aggressive canonicalization can
  hide real loss. Mitigation: canonicalize only key order, synthesized filenames, and
  number/unit formatting; everything else must match byte-for-byte or be in the
  documented lossy set with a `CatalogWarning`.
- **Size budget.** The importer/exporter and propagator adapters are not first-paint.
  Mitigation: keep them behind a dynamic import in the catalog-load path so they land
  in the lazy analysis bundle, not the shell; verify with `pnpm size`.
- **Schema `oneOf` discrimination.** A loose `oneOf` can validate ambiguously.
  Mitigation: each branch pins `type` to a `const` and sets
  `additionalProperties:false`, and `schema.test.ts` asserts each fixture matches
  exactly one branch.
- **Cosmographia include resolution on web.** Multi-file Catalog Lists assume a
  filesystem. Mitigation: on web, require includes pre-bundled or reject loudly with a
  located error; full include resolution is available on the Electron/Node PAL.
