# Bessel

An open-source, SPICE-aware 3D mission visualization application, delivered from a
single codebase as a Progressive Web App, as native mobile apps (via Capacitor),
and as a desktop app (via Electron). It reads Cosmographia-compatible catalogs,
drives geometry from CSPICE compiled to WebAssembly, and renders with Three.js.

License: Apache-2.0 (LICENSE at the root).

Program objective: a fully featured, production quality, efficient application
suitable for the NASA-AMMOS product suite alongside MMGIS. The objective is
enforced by verifiable gates (ADR-0009).

## What this repository contains

A pnpm workspace monorepo: typed core packages (`packages/`), a platform
abstraction layer with web, Electron, and Capacitor implementations, and the
three app shells (`apps/web`, `apps/desktop`, `apps/mobile`). The web app boots a
neutral inner-solar-system scene and renders any loaded mission through a generic,
catalog-driven builder.

## Running it

```
pnpm install
pnpm --filter @bessel/web dev      # web app (Vite dev server)
pnpm build:web                     # production PWA build
pnpm build:desktop                 # Electron build
pnpm cap:sync                      # sync the iOS shell against the web build
```

`pnpm verify` runs the gate (typecheck, lint, test, build:web, size). The full
verifiable command catalog is in CLAUDE.md and SPEC.md Section 8; CI runs the
same vocabulary (`.github/workflows/ci.yml`).

## Sample missions

The web app boots into a neutral inner-solar-system scene; no mission is baked
in. Missions are data: load a Cosmographia or native Bessel catalog through the
Mission panel (the "Load catalog" button, or drag and drop a JSON file), and the
generic builder renders it (bodies, spacecraft, trajectory, the seven geometry
types, rings, atmosphere, axis triads, direction vectors, the instrument field
of view and footprint, and a glTF model).

A worked example ships as a one-click sample: "Load Cassini at Saturn" in the
Mission panel loads `apps/web/public/samples/cassini-saturn.json`, a native
catalog that drives the Cassini-at-Saturn scene (Saturn globe with image texture,
rings, and an atmosphere; the Cassini trajectory, glTF model, and a uniform
spin; and the ISS wide-angle FOV cone and footprint) entirely from catalog data.
The Operations panel also lists this mission from the plugin registry, runs a
scripted guided tour, and shows a predicted-versus-actual telemetry residual.
Copy and edit the sample file as a starting point for your own mission; the
kernels its bodies need must be furnished (the bundled demo kernels cover the
inner system, Saturn, and Cassini).

## Where to start

1. VISION.md: why Bessel exists and what it is.
2. SPEC.md: the master specification and the verifiable command catalog.
3. docs/PARITY_MATRIX.md: the feature-by-feature parity check against
   Cosmographia, with the current implemented status.
4. docs/catalog-schema.md: the native catalog schema for authoring missions.
5. docs/adr/: the binding architecture decisions.
6. REFERENCES.md: curated sources.

## Project configuration

- CLAUDE.md: canonical agent context (AGENTS.md is a thin pointer for other
  harnesses): tech stack, the verifiable command catalog, the dependency rule,
  and the working conventions.
- docs/adr/: the binding architecture decisions.
- .claude/commands/: `/verify` runs the gate and the post-change review checks.
- .claudeignore: secrets and bulk kernel data the agent must not touch.
- .github/workflows/ci.yml: CI running the same gate vocabulary as `pnpm verify`.
- .size-limit.json, lighthouserc.json: the efficiency budgets (hard gates).
- docs/integrations.md: the MMGIS deep-link contract, grounded in the MMGIS
  repository (scripts/fetch-mmgis-reference.sh keeps a local reference copy).
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md: governance.

## House rules

Do not use em dashes anywhere in this repository (code, comments, docs, commit
messages, UI copy). Use commas, colons, parentheses, or semicolons.
