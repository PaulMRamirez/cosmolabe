# Bessel

[![CI](https://github.com/PaulMRamirez/bessel/actions/workflows/ci.yml/badge.svg)](https://github.com/PaulMRamirez/bessel/actions/workflows/ci.yml)
[![Deploy](https://github.com/PaulMRamirez/bessel/actions/workflows/deploy.yml/badge.svg)](https://github.com/PaulMRamirez/bessel/actions/workflows/deploy.yml)

Live demo: https://paulmramirez.github.io/bessel/

An open-source, SPICE-aware 3D mission visualization application, delivered from a
single codebase as a Progressive Web App, as native mobile apps (via Capacitor),
and as a desktop app (via Electron). It reads Cosmographia-compatible catalogs,
drives geometry from CSPICE compiled to WebAssembly, and renders with Three.js.

Beyond visualization, Bessel ships a validated mission-analysis engine layer
(orbit propagation, access, lighting, communications, conjunction, attitude,
coverage, maneuver design, and CCSDS interop) surfaced in a single task-framed
six-tab Analyze workbench (see docs/analysis-workbench.md and
docs/analysis-personas.md). It also runs headless: special-perturbations propagation (NxN gravity,
drag, SRP) with dense output, event detection, and the State Transition Matrix; an
Astrogator-class Mission Control Sequence with a differential corrector, nested
targeting, finite burns, and a fuel-optimal gradient optimizer; orbit determination
(batch least-squares and an EKF, with light-time and consider parameters); the
EOP-aware TEME to J2000 transform; and a deterministic batch runner
(`@bessel/sdk` and the `bessel` CLI) that executes a JSON job with no UI. Every analysis quantity is asserted against an
independent numeric reference; see docs/analysis-tools.md and
docs/STK_PARITY_SPEC.md.

License: Apache-2.0 (LICENSE at the root).

Program objective: a fully featured, production quality, efficient application.
The objective is enforced by verifiable gates (ADR-0009).

## What this repository contains

A pnpm workspace monorepo of 27 typed core packages (`packages/`), a platform
abstraction layer with web, Electron, Capacitor, and Node implementations, and the
app shells (`apps/web`, `apps/desktop`, `apps/mobile`, and the `apps/cli` headless
batch runner). The web app boots a neutral inner-solar-system scene and renders any
loaded mission through a generic, catalog-driven builder.

The core packages split into two families (see docs/architecture.md for the full
map):

- Visualization and platform: `spice` (CSPICE-WASM in a Web Worker), `catalog`,
  `scene`, `timeline`, `state`, `color`, `ui`, and the `pal` interface with its
  `pal-web` / `pal-electron` / `pal-capacitor` implementations.
- Analysis engines: `propagator` (SGP4, two-body, J2/J4, Cowell HPOP with NxN
  gravity, drag, and SRP, dense output + events + STM, an Astrogator-class MCS with a
  differential corrector, nested targeting and finite burns, and TEME to J2000),
  `od` (orbit determination: batch least-squares and an EKF), `access`, `events`
  (eclipse), `rf` (link budgets), `coverage`, `conjunction`, `attitude`, `sensors`,
  `mission` (Lambert, maneuvers), `map-projection`, `interop` (CCSDS OEM/OMM/CDM),
  `analysis`, and `terrain`.
- Automation: `sdk` (a JSON batch-job IR, a `defineJob` builder, and a headless
  `runJob` runner) with `pal-node` (Node kernel/file IO) driving the `bessel` CLI.

## Running it

```
pnpm install
pnpm --filter @bessel/web dev      # web app (Vite dev server)
pnpm build:web                     # production PWA build
pnpm build:desktop                 # Electron build
pnpm cap:sync                      # sync the iOS shell against the web build
pnpm build:cli                     # bundle the bessel headless batch runner to a Node binary
```

Run a headless batch job once the CLI is built:

```
node apps/cli/dist/main.js run mission.job.json --out ./artifacts
```

`pnpm verify` runs the gate (typecheck, lint, test, build:web, size). The full
verifiable command catalog is in CLAUDE.md and SPEC.md Section 8; CI runs the
same vocabulary (`.github/workflows/ci.yml`) on every push and pull request.

The PWA is deployed to GitHub Pages on every push to `main`
(`.github/workflows/deploy.yml`): `pnpm build:pages` builds it under the `/bessel/`
project-page base (local dev, the gate, and the Electron/Capacitor shells keep the
`/` base), and the result is published at https://paulmramirez.github.io/bessel/.

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

## Mission analysis workbench

The **Analyze** toggle in the app shell opens one task-framed, pinnable analysis dock.
It is organized into six domain tabs, each surfacing its engines as collapsible
TaskCards over a shared Scenario context (epoch, span/step, target, observer, frame,
and a ground-station registry), with an intent search box and mission-profile presets
as accelerators. Results render as Gantt timelines, time-series charts, ground-track
overlays, report tables, and file exports. Full reference: docs/analysis-workbench.md,
docs/analysis-personas.md, and docs/analysis-tools.md.

- Orbit & Maneuver: propagate a user spacecraft source (paste a TLE or pick a scene
  object) with SGP4 vs the numerical HPOP integrator (selectable force model:
  point-mass / J2 / NxN gravity / drag / SRP); build and run an editable Mission
  Control Sequence with a differential corrector; orbit determination (batch
  least-squares with residual RMS and covariance); an eigen-axis attitude slew; and a
  worker-swept Lambert transfer + porkchop that sends the best transfer to the MCS.
- Lighting & Geometry: range, ground track (selectable projection with station
  overlays), solar beta-angle season, four-phase eclipse windows, and solar intensity.
- Access & Comms: a composable constraint-stack access window (line of sight / range /
  range rate / sun keepout / az-el mask / terrain) with a per-constraint breakdown;
  ground-station passes; in-FOV observation windows; an itemized link-budget worksheet
  with modcod margin; slew feasibility; and a conflict-free multi-target observation
  schedule.
- Conjunction: ingest real CCSDS CDM / OEM / TLE data, run an all-vs-all worker screen,
  and triage a Pc-colored event table with full-covariance Pc, a Max-Pc bound, an SVG
  B-plane plot, an avoidance-burn carrier into the MCS, a screen-after-maneuver
  before/after Pc, a watchlist, and CDM export.
- Coverage & Constellation: design a Walker constellation that publishes its members
  as the swept asset set, then sweep a figure-of-merit grid on a worker into a
  metric-aware contour with a legend and a regional FOM summary.
- Report & Compare: run a data-provider report (range, range rate, speed, position,
  velocity, sub point) over an observer/target grid; export the trajectory as a CCSDS
  OEM; and compare kept snapshots side by side in the compare tray.

Long sweeps (catalog screening, the coverage grid, the porkchop) run on cancellable
workers with progress. Every engine is validated against an independent reference
(docs/STK_PARITY_SPEC.md, REFERENCES.md).

The shell also carries Cosmographia-style interaction menus: a Script console (run a
BesselScript program against the live viewer), a Plugins loader (load a registered
mission add-on, furnishing its kernels in dependency order), and a Telemetry overlay
(predicted-versus-actual residuals in OpenMCT/Yamcs idioms).

## Where to start

1. docs/getting-started.md: load a mission, explore, run an analysis, export.
2. docs/analysis-tools.md: one entry per workbench tool (inputs, what it computes,
   validation, limits).
3. docs/architecture.md: the layering and the 24-package map.
4. SPEC.md: the visualizer specification and the verifiable command catalog;
   docs/STK_PARITY_SPEC.md: the analysis-engine specification and status.
5. docs/PARITY_MATRIX.md: the feature-by-feature parity check against
   Cosmographia, with the current implemented status.
6. docs/catalog-schema.md: the native catalog schema for authoring missions.
7. docs/build-from-source.md: building, the CSPICE-WASM relink, and the gates.
8. docs/adr/: the binding architecture decisions. REFERENCES.md: curated sources.

A by-audience index of all documentation is in docs/README.md.

## Project configuration

- CLAUDE.md: canonical agent context: tech stack, the verifiable command
  catalog, the dependency rule, and the working conventions.
- docs/adr/: the binding architecture decisions.
- .claudeignore: secrets and bulk kernel data the agent must not touch.
- .github/workflows/ci.yml: CI running the same gate vocabulary as `pnpm verify`.
- .size-limit.json, lighthouserc.json: the efficiency budgets (hard gates).
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md: governance.

## House rules

Do not use em dashes anywhere in this repository (code, comments, docs, commit
messages, UI copy). Use commas, colons, parentheses, or semicolons.
