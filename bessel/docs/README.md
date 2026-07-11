# Bessel Documentation

Start at the repository [README](../README.md) for the overview. This index routes
each audience to the right document.

## By audience

- New users and educators: [getting-started.md](getting-started.md) (load,
  explore, analyze, export), then [analysis-tools.md](analysis-tools.md).
- Mission analysts: [analysis-tools.md](analysis-tools.md) (per-tool inputs,
  outputs, validation, limits, plus the headless batch runner and the `bessel`
  CLI), [STK_PARITY_SPEC.md](STK_PARITY_SPEC.md) (the analysis-engine spec and
  status), and [../REFERENCES.md](../REFERENCES.md) (the algorithm provenance).
- Contributors: [architecture.md](architecture.md) (the layering and package
  map), [build-from-source.md](build-from-source.md) (building and the
  CSPICE-WASM relink), [../CONTRIBUTING.md](../CONTRIBUTING.md), the decision
  records in [adr/](adr/), and [../SPEC.md](../SPEC.md).
- Integrators and mission authors: [catalog-schema.md](catalog-schema.md) (the
  native catalog format), [integrations.md](integrations.md) (the MMGIS deep-link
  contract, CZML export, and the MONTE interchange relationship), and the PAL
  described in [architecture.md](architecture.md).

## By topic

- Visualization and the catalog: [catalog-schema.md](catalog-schema.md),
  [../SPEC.md](../SPEC.md).
- Mission analysis: [analysis-tools.md](analysis-tools.md),
  [STK_PARITY_SPEC.md](STK_PARITY_SPEC.md), [../REFERENCES.md](../REFERENCES.md).
- Architecture and build: [architecture.md](architecture.md),
  [build-from-source.md](build-from-source.md), [adr/](adr/).
- Integration: [integrations.md](integrations.md) (MMGIS, CZML, MONTE),
  [adr/](adr/).

## Status and specifications

- [../SPEC.md](../SPEC.md): the authoritative visualizer specification and the
  verifiable command catalog.
- [STK_PARITY_SPEC.md](STK_PARITY_SPEC.md): the analysis-engine specification; its
  Section 9 is the living implementation status.
- [PARITY_MATRIX.md](PARITY_MATRIX.md): the feature-by-feature parity check against
  the Cosmographia visualizer.
- [../CHANGELOG.md](../CHANGELOG.md): the release history (aggregated from
  Changesets).

## Decision records

Architecture Decision Records live in [adr/](adr/). They are append-only: an
accepted ADR is not edited; a changed decision is captured in a new ADR that
supersedes it. ADR-0001 explains the format.

## Contributing

The gate is `pnpm verify` plus `pnpm e2e`; see [build-from-source.md](build-from-source.md)
and [../CONTRIBUTING.md](../CONTRIBUTING.md). The in-repo conventions (including
the no-em-dashes house rule) are in [../CLAUDE.md](../CLAUDE.md).
