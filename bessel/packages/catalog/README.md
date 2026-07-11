# @bessel/catalog

Catalog layer for Bessel: parses Cosmographia catalogs, defines the native Bessel
catalog schema (and its typed mirror), validates catalogs against JSON Schema with
located errors, resolves the kernels a catalog references through the PAL, and hosts
the mission plugin registry (ADR-0006). Core layer: depends only on the PAL interface.

## Public API

Native schema and types:

- `parseBesselCatalog`, `validateCatalog`, `schemaIsValid`, `ValidationResult`: validate
  raw input against `bessel-catalog.schema.json` (Draft 2020-12), then cross-check that
  `instrument.parent` and `observation.instrument` references resolve.
- `native-types.ts` re-exports: `BesselCatalog`, `CatalogBody`, `CatalogSpacecraft`,
  `CatalogInstrument`, `CatalogObservation`, `Trajectory`, `Orientation`, `Geometry`,
  `GEOMETRY_TYPES`, and supporting shapes (`Arc`, `TimeRange`, `CssColor`, etc.).

Cosmographia compatibility:

- `parseCosmographiaCatalog(raw)`: returns the first spacecraft as a typed
  `SpacecraftCatalog` (Phase 0 supports the `Spice` trajectory subset).
- `CosmographiaCatalog`, `CosmographiaItem` types.

Kernels and plugins:

- `resolveCatalogKernels(catalog, source)`: resolves every referenced kernel through a
  PAL `KernelSource`, throwing a located `PalError` for the first that cannot be found.
- `PluginRegistry`, `MissionPlugin`: register missions, de-duplicate required kernels,
  and lazily load/cache a mission's catalog on activation.

Errors:

- `CatalogError`: a located, typed error naming the offending field (loud failure).

```ts
import { parseBesselCatalog, resolveCatalogKernels } from '@bessel/catalog';

const catalog = parseBesselCatalog(rawJson); // throws CatalogError on a bad field
const handles = await resolveCatalogKernels(catalog, kernelSource);
```

## Dependency rule

Depends on: `@bessel/pal` (plus `ajv` and `ajv-formats` for schema validation). Part of
the core layer: it imports only the PAL interface, never a concrete PAL implementation,
the SPICE engine, Three.js, or UI.

## Tests

Tests live in `packages/catalog/src/*.test.ts`: `catalog.test.ts` (Cosmographia parsing
against the bundled Cassini example, plus loud-failure cases), `schema.test.ts` and
`taxonomy.test.ts` (native schema and geometry taxonomy), `kernels.test.ts` (PAL kernel
resolution), and `plugins.test.ts` (registry behavior).

## Status / limitations

Cosmographia parsing is Phase 0: it extracts a single spacecraft with a `Spice`
trajectory; the wider geometry taxonomy is modeled in the native schema but not yet
parsed from Cosmographia input.
