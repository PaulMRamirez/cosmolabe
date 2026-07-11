# Bessel Specification

Status: Draft v1.0
Date: 2026-06-07
Owner: Paul Ramirez
Companion documents: REFERENCES.md, docs/adr/, docs/PARITY_MATRIX.md (implemented status)

This specification is written to be executed. Every phase in Section 9 states a
completion condition as runnable commands so that a Claude Code `/goal` session,
and its independent completion checker, can determine objectively when the phase
is done. The verifiable command catalog is defined in Section 8 and mirrored in
CLAUDE.md.

---

## 1. Scope

Bessel is a single-codebase, SPICE-aware 3D mission visualization application
delivered as a Progressive Web App, as native mobile apps via Capacitor, and as
a desktop app via Electron. It reads Cosmographia-compatible catalogs and a
native collapsed catalog schema, drives geometry from CSPICE compiled to
WebAssembly, and renders with Three.js.

Program objective: a fully featured, production quality, efficient application
suitable for the NASA-AMMOS product suite alongside MMGIS. Production quality
and efficiency are enforced as verifiable gates (ADR-0009), and suite
membership is implemented as a URL contract with MMGIS (ADR-0008,
docs/integrations.md, grounded in the MMGIS repository). Phase 5 certifies the
objective.

This document specifies the visualization application. The mission-analysis engine
layer (propagation, access, lighting, communications, conjunction, attitude,
coverage, maneuver design, and CCSDS interop) is specified separately in
docs/STK_PARITY_SPEC.md; the two documents are complementary, and the analysis
packages enumerated in STK_PARITY_SPEC.md Section 10 also live in this workspace.

In scope for the program described here:

- A composable monorepo of platform-agnostic core packages.
- A Platform Abstraction Layer with web, Capacitor, and Electron implementations.
- Three application shells over a shared React UI.
- Cosmographia catalog compatibility plus a native schema and round-trip layer.
- A mission plugin surface.
- A mission-analysis engine layer surfaced in interactive workbenches (specified
  in docs/STK_PARITY_SPEC.md).
- Operations features: shareable URL state, geometric readouts, capture, and
  later, live telemetry overlays.
- Suite deep links: MMGIS (surface), both directions, plus CZML interchange.
- Production engineering: CI mirroring the /goal gates, performance and bundle
  budgets, dependency audit, accessibility gates, and a changesets release
  pipeline with alpha, beta, and stable channels.

Out of scope (handled by adjacent systems):

- Planetary surface GIS (MMGIS).
- Telemetry archive and processing (Yamcs).
- Reimplementing SPICE math (NAIF CSPICE is linked, not rewritten).

---

## 2. Carried-forward decisions

These were settled in prior Bessel design work and are re-affirmed here.
See docs/adr/ for the full rationale and the tri-target additions.

- Rendering engine: Three.js (WebGL2 first, WebGPU migration later). ADR-0003.
- SPICE engine: CSPICE to WASM, forked from arturania/cspice, run in a Web
  Worker. ADR-0004.
- Camera-relative rendering to defeat float32 jitter at solar-system distances.
- Catalog model: parse Cosmographia catalogs for compatibility; introduce a
  collapsed instrument schema with a targets array to remove the
  per-sensor-per-target file explosion; provide a round-trip compatibility
  layer. ADR-0006.
- Plugin model: JUICE-style mission extension modules. ADR-0007.
- The undocumented Cosmographia colorScheme / colorByDistance slot maps to a
  generic color strategy system. ADR-0006.
- UX correction: missing kernels and unresolved bodies produce explicit errors,
  never a silent re-center on the Sun.

New for this program:

- Tri-target delivery (PWA, Capacitor, Electron) from one codebase behind a
  Platform Abstraction Layer. ADR-0002.
- Per-platform kernel hosting and filesystem strategy. ADR-0005.

---

## 3. Architecture overview

Five layers, strictly ordered by dependency direction. Lower layers never
import higher ones, and the core never imports a concrete platform API.

```
+-----------------------------------------------------------+
|  Shells:   apps/web (PWA)   apps/desktop (Electron)       |
|            apps/mobile (Capacitor)                        |
+-----------------------------------------------------------+
|  UI:       @bessel/ui  (React + TypeScript components) |
+-----------------------------------------------------------+
|  PAL:      @bessel/pal  (interface)                    |
|            pal-web | pal-capacitor | pal-electron (impls) |
+-----------------------------------------------------------+
|  Core:     @bessel/spice    @bessel/catalog         |
|            @bessel/scene    @bessel/timeline        |
|            @bessel/state    @bessel/color           |
+-----------------------------------------------------------+
|  Plugins:  mission extension modules (lazy-loaded)        |
+-----------------------------------------------------------+
```

Dependency rule: core packages depend only on each other and on the PAL
interface (never a PAL implementation). The UI depends on core and PAL
interface. Shells select and inject the correct PAL implementation at startup.
This is the property that keeps the three targets swappable and avoids coupling
the product to any single runtime.

---

## 4. Repository layout

A pnpm workspace monorepo.

```
bessel/
  package.json                 # workspace root, shared scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    spice/        # @bessel/spice    CSPICE-WASM wrapper, Web Worker, typed API
    catalog/      # @bessel/catalog  parser, native schema, compatibility layer
                  #   schema/bessel-catalog.schema.json + examples/ (Cassini)
    scene/        # @bessel/scene    Three.js scene graph builder
    timeline/     # @bessel/timeline time model, playback, rate, epoch
    state/        # @bessel/state    view model, URL state serialization
    color/        # @bessel/color    color strategy system (colorScheme hook)
    pal/          # @bessel/pal      interface + pal-web, pal-capacitor, pal-electron, pal-node
    ui/           # @bessel/ui       React components, panels, controls
                  # the workspace also contains the analysis-engine packages
                  #   (propagator, od, access, events, rf, coverage, conjunction,
                  #   attitude, sensors, mission, map-projection, interop, analysis,
                  #   terrain) and the headless automation package sdk,
                  #   specified in docs/STK_PARITY_SPEC.md Section 10
  apps/
    web/          # Vite + vite-plugin-pwa; the canonical build all targets consume
    desktop/      # electron-vite; main, preload, renderer; IPC bridge
    mobile/       # capacitor.config.ts + ios/; webDir -> apps/web/dist
                  #   (Android deferred from gates; architecture unchanged, ADR-0002)
    cli/          # the bessel headless batch runner over @bessel/sdk + pal-node
  kernels/        # sample meta-kernels + a fetch script (large data git-ignored)
  e2e/            # Playwright cross-target end-to-end tests
  docs/           # spec companion docs: adr, parity matrix, catalog schema, integrations
  .claude/        # settings
  CLAUDE.md       # canonical agent context (Claude Code reads this)
  .claudeignore
```

---

## 5. Core packages

### 5.1 @bessel/spice

Wraps CSPICE-WASM and runs it in a dedicated Web Worker so the main thread never
blocks on furnsh or geometry calls. Exposes a typed, promise-based API over the
minimal SPICE surface the renderer needs:

- Kernel management: `furnsh`, `unload`, `kclear`, `ktotal`.
- Time: `str2et`, `et2utc`, `utc2et`, `sce2c`, `sct2e`.
- Position and state: `spkpos`, `spkezr`.
- Frames: `pxform`, `sxform`.
- Instruments: `getfov` (boresight and FOV boundary vectors), `bodvrd`,
  `bodvcd`.
- Surface intercept: `sincpt`, `subpnt`, `ilumin` (for footprints and
  illumination geometry).

Kernel bytes are never read by this package directly. They arrive through the
PAL `KernelSource` (Section 6), which lets the same engine load kernels by HTTP
range request, from a Capacitor native path, or from the Electron local
filesystem.

Acceptance signal: unit tests load an LSK plus a planetary SPK fixture and
assert `spkpos` of a known body at a known epoch matches a NAIF reference value
within tolerance.

### 5.2 @bessel/catalog

- Parses Cosmographia JSON catalogs across the full geometry taxonomy
  established in prior work: Mesh, DSK, Globe, Rings, ParticleSystem,
  KeplerianSwarm, TimeSwitched, plus annotations.
- Defines the native Bessel schema: a single manifest with a collapsed
  instrument object carrying a `targets[]` array, eliminating the
  per-sensor-per-target file explosion. The schema is checked in as JSON Schema
  Draft 2020-12 at packages/catalog/schema/bessel-catalog.schema.json (27
  definitions), with a Cassini-style reference instance under examples/ and the
  design recorded in docs/catalog-schema.md. See ADR-0006.
- Provides a round-trip compatibility layer: Cosmographia in, native out, and
  native back to Cosmographia where lossless.
- Validates against the schema and emits explicit, located errors on bad
  references (the loud-failure principle). Notable guards: spacecraft single-arc
  and multi-arc forms are mutually exclusive, and sideDivisions has a floor of 2
  (the Cosmographia crash case).

Acceptance signal: the schema passes Draft 2020-12 meta-validation; the
Cassini-style instance validates clean; and two negative cases (a spacecraft with
both arcs and trajectory; sideDivisions 1) are rejected. A deliberately broken
reference yields a typed error naming the offending field.

### 5.3 @bessel/scene

Builds and updates the Three.js scene graph from catalog plus SPICE state:

- Body nodes (textured globes, rings).
- Spacecraft nodes (GLTF), with attached sensor FOV cone meshes, trajectory
  polylines, and reference-frame axis triads.
- Observation footprints via surface intercept.
- Direction vectors and labels.
- Camera controller with orbit, center-on-body, and track-along-trajectory
  modes, using camera-relative rendering so positions are computed relative to
  the camera before being handed to the GPU.

Acceptance signal: given a fixture trajectory, the builder produces a scene with
the expected node count and types, and a headless render snapshot is non-empty.

### 5.4 @bessel/timeline

Time model and playback: epoch, play and pause, rate adjustment, scrub, and a
clock that the scene subscribes to. All time is internally ephemeris time;
display formatting is UTC and calendar via SPICE.

### 5.5 @bessel/state

The view model and its URL serialization. A view (epoch, camera pose and mode,
selection, visibility toggles, active mission plugins) is encoded into a compact
URL fragment and decoded on load. This is the basis for shareable links and is a
first-class differentiator from Cosmographia.

Acceptance signal: round-trip property test, encode then decode equals the
original view model for a generated sample of views.

### 5.6 @bessel/color

A color strategy system: named strategies map a scalar (distance, phase angle,
parameter value) to a color ramp. It is the home for the Cosmographia colorScheme
/ colorByDistance hook, exposed as a generic, extensible set of named strategies.

---

## 6. Platform Abstraction Layer

`@bessel/pal` defines interfaces; the core and UI depend only on these. Each
shell injects one concrete implementation at startup.

Interfaces (minimum):

- `KernelSource`: enumerate available kernels, open a kernel as a byte stream or
  range-readable handle, and report a stable identity for caching.
- `FileSystem`: read and write app data (catalogs, view bundles, exported
  products).
- `Storage`: key-value preferences.
- `Share`: produce a shareable link or hand a file to the platform share sheet.
- `Capabilities`: feature flags so the UI can degrade gracefully
  (for example, no Python bridge on web or mobile).

Implementations:

- `pal-web`: Fetch with HTTP range requests for kernels, OPFS for the kernel
  cache and app data, File System Access API where available, drag-and-drop
  import as fallback. A small optional companion kernel proxy service can front
  the PDS NAIF mirror to resolve CORS and enable range requests. ADR-0005.
- `pal-capacitor`: Capacitor Filesystem for kernels and app data, Preferences
  for storage, Share for links and files. Kernel bundles import as a zip or
  download on demand into app storage.
- `pal-electron`: Node filesystem over a typed IPC bridge from preload, with
  meta-kernel (.tm) path resolution for desktop parity with Cosmographia, native
  open and save dialogs, and the optional Python scripting bridge.

Acceptance signal: a PAL contract test suite runs against every implementation;
`pal-web` and `pal-electron` both pass the same `KernelSource` contract using
their respective fixtures.

---

## 7. Application shells

- apps/web: the canonical Vite build. vite-plugin-pwa supplies the Workbox
  service worker and the web manifest. This build output (apps/web/dist) is what
  Capacitor wraps and what the desktop renderer loads.
- apps/desktop: electron-vite project with main, preload, and renderer. Preload
  exposes the typed IPC surface that pal-electron consumes. electron-builder
  produces signed installers per OS in a later phase.
- apps/mobile: Capacitor configuration and the generated ios native project,
  with webDir pointed at apps/web/dist. `cap sync` keeps native projects
  current after each web build. The Android target remains part of the
  architecture (ADR-0002) but is deferred from the build gates until needed;
  enabling it later is `cap add android` plus restoring it to the cap:sync
  script.

Rationale for electron-vite over the community Capacitor Electron target is in
ADR-0002: it keeps the desktop bridge explicit and avoids coupling the desktop
target to Capacitor's plugin lifecycle, which fits the composability principle.

---

## 8. Verifiable command catalog

These scripts are defined at the workspace root and are the vocabulary the
`/goal` completion checker uses. They must exist and exit 0 on success.

| Script               | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`     | `tsc --noEmit` across all packages and apps                    |
| `pnpm lint`          | ESLint across the workspace, zero warnings                     |
| `pnpm test`          | Unit and contract tests (Vitest), all passing                  |
| `pnpm build:web`     | Vite production build of apps/web                              |
| `pnpm build:desktop` | electron-vite build of apps/desktop                            |
| `pnpm build:cli`     | bundle apps/cli to a runnable Node binary (the bessel batch runner) |
| `pnpm cap:sync`      | `cap sync ios` against apps/web/dist (Android deferred)        |
| `pnpm e2e`           | Playwright end-to-end suite (headless), including the a11y scan|
| `pnpm size`          | size-limit budget check against .size-limit.json               |
| `pnpm audit:prod`    | pnpm audit, production deps, fails on high or critical         |
| `pnpm lhci`          | Lighthouse CI assertions (lighthouserc.json) on the built PWA  |
| `pnpm bench`         | Vitest bench micro-benchmarks (informational, not a CI gate)   |
| `pnpm release:dry`   | changesets version and publish dry-run                         |
| `pnpm verify`        | typecheck, lint, test, build:web, size in sequence; the gate   |

CI (.github/workflows/ci.yml) runs this same vocabulary, so the developer, the
/goal completion checker, and CI cannot disagree (ADR-0009).

Conventions for verifiable conditions, applied throughout Section 9:

- A build step "succeeds" means it exits 0 and produces the named artifact.
- A PWA build is "valid" when apps/web/dist contains both a
  `manifest.webmanifest` and a generated service worker file, asserted by a test
  in the e2e or build-check suite.
- "Renders" is asserted by a Playwright test that loads a fixture catalog and
  checks for the expected canvas and a non-empty WebGL frame, not by visual
  judgement.

---

## 9. Phased build with completion conditions

Each phase below was built and its completion condition is expressed as runnable
commands so it can be verified objectively. This section is retained as the
acceptance-criteria record; the current implemented status is tracked in
docs/PARITY_MATRIX.md.

### Phase 0: Proof of concept (PWA only)

Goal: prove the spine end to end in the browser.

Build: CSPICE-WASM in a Web Worker; load an LSK plus planetary SPKs via
pal-web; render the inner solar system with textured planets; basic time
controls (play, pause, rate, epoch entry); orbit and center-on-body camera;
parse one Cosmographia spacecraft catalog and render its trajectory polyline.

Demo target: a Cassini-at-Saturn trajectory with working time scrubbing,
installable as a PWA.

Completion condition (verifiable):
- `pnpm typecheck` exits 0.
- `pnpm test` exits 0, including the @bessel/spice fixture test that asserts
  `spkpos` of a known body matches a NAIF reference within tolerance.
- `pnpm build:web` succeeds and the output contains a valid manifest and service
  worker.
- `pnpm e2e` includes a test "poc-cassini" that loads the fixture catalog and
  asserts the trajectory renders (non-empty frame) and that advancing the
  timeline changes the rendered frame.

### Phase 1: Core visualization (all three targets)

Goal: feature-complete single-mission viewing, building on every target.

Build: full catalog parser across the seven geometry types plus annotations;
GLTF spacecraft; sensor FOV cones from `getfov`; observation footprints from
`sincpt`; reference-frame axes and direction vectors; object browser panel;
visualization settings panel; keyboard shortcuts matching Cosmographia
conventions; the explicit missing-kernel error behavior. PAL implemented for
web; Capacitor and Electron shells building and launching the same UI.

Completion condition (verifiable):
- `pnpm verify` exits 0 (typecheck, lint, test, build:web).
- `pnpm build:desktop` succeeds and produces a runnable Electron build.
- `pnpm cap:sync` succeeds for ios.
- `pnpm test` includes catalog tests covering all seven geometry types; a schema
  test asserting the Cassini-style example validates and that the two negative
  cases are rejected (a spacecraft with both arcs and trajectory; sideDivisions 1);
  and a test asserting a broken kernel reference yields a typed, located error
  rather than a silent re-center.
- `pnpm e2e` includes tests for FOV cone rendering and footprint rendering on a
  fixture mission.

### Phase 2: Operations features

Goal: make it useful for real operations and review.

Build: URL state serialization (shareable views) wired end to end through
@bessel/state; screen capture and video recording; geometric readouts (range,
phase angle, incidence, emission); multi-object selection; timeline annotations
with event markers; suite deep links per docs/integrations.md (MMGIS time sync
and lat/lon handoff, both directions); CZML export for CesiumJS interop; PWA
offline with an OPFS kernel cache via pal-web.

Completion condition (verifiable):
- `pnpm verify` exits 0.
- `pnpm test` includes the @bessel/state round-trip property test (encode then
  decode equals the original view), a CZML export test validating output
  against the CZML structure for a fixture trajectory, and suite URL tests
  asserting well-formed outbound MMGIS URLs from fixture selections (the
  parameter table in docs/integrations.md, including the lon, lat, zoom triple
  rule).
- `pnpm e2e` includes a test that loads a shared URL and asserts the
  reconstructed epoch, camera, and selection match the encoded view; a test
  that confirms a second load works offline against the OPFS cache; and an
  accessibility scan (axe) reporting zero serious or critical violations on the
  main view.
- `pnpm lhci` exits 0 against the production web build (performance at or above
  0.8, accessibility and best practices at or above 0.9).

### Phase 3: Desktop depth and advanced rendering

Goal: desktop parity with Cosmographia, plus the rendering features that need it.

Build: Electron meta-kernel (.tm) path resolution in pal-electron; Python
scripting bridge (Electron only) for batch geometry products; DSK shape-model
rendering; atmosphere shaders (Rayleigh and Mie); shadow mapping; ring rendering;
star field from a catalog; Capacitor native filesystem kernel import and
app-store-ready packaging.

Completion condition (verifiable):
- `pnpm verify` exits 0 and `pnpm build:desktop` succeeds.
- `pnpm test` includes a pal-electron meta-kernel resolution test (a .tm with
  relative paths resolves to loadable kernels in a fixture tree) and a Capabilities
  test asserting the Python bridge is reported present on Electron and absent on
  web and Capacitor.
- `pnpm e2e` includes a desktop test (Playwright Electron) that loads a
  meta-kernel and renders a DSK body.

### Phase 4: Real-time and collaboration

Goal: live operations and shared sessions, plus plugin GA.

Build: WebSocket telemetry ingestion with Yamcs and OpenMCT adapters;
predicted-versus-actual ephemeris overlay; multi-user shared sessions; WebXR
support; the mission plugin architecture at general availability (a JUICE-style
module registry with lazy loading and a declarative manifest: mission id,
kernels, frames, catalog overlays, custom panels, color strategies).

Completion condition (verifiable):
- `pnpm verify` exits 0.
- `pnpm test` includes a plugin-registry test that loads a fixture mission plugin
  and asserts its kernels, frames, and panels register, plus a telemetry-adapter
  test that drives a mock Yamcs WebSocket and asserts the overlay updates.
- `pnpm e2e` includes a test that connects to a mock telemetry source and
  confirms the predicted-versus-actual overlay renders.

### Phase 5: Production hardening and GA

Goal: certify the program objective: production quality, efficient, and
suite-ready. Hardening, not new features.

Build: electron-builder packaging for Linux, macOS, and Windows (unsigned
artifacts; signing hooks present, completed by a human with certificates); a
changesets-driven release workflow (version, changelog, npm dry-run); error
boundaries and a typed user-facing error surface; opt-in diagnostics (no
telemetry by default); full keyboard operability; suite URL contract
integration tests; documentation completeness (README quickstart verified by
script, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, generated CHANGELOG).

Completion condition (verifiable):
- `pnpm verify` exits 0.
- `pnpm build:desktop` succeeds and electron-builder produces unsigned
  artifacts for the host platform in dry-run mode.
- `pnpm audit:prod` exits 0.
- `pnpm lhci` exits 0 against the production web build.
- `pnpm e2e` exits 0, including the a11y scan (zero serious or critical
  violations) and the suite URL contract tests.
- `pnpm release:dry` exits 0.

---

## 10. Non-functional requirements

- Performance: maintain interactive frame rates (target 60, floor 30 on a
  mid-range laptop) with a solar-system scene and at least one spacecraft with
  FOV and footprint; large distances must not jitter (camera-relative rendering
  is mandatory, not optional). Runtime frame rate is measured by `pnpm bench`
  and real-device checks; it is an NFR, not a CI gate (ADR-0009).
- Efficiency budgets (hard gates, ADR-0009): initial web app shell JS at or
  under 350 KB gzip (.size-limit.json); CSPICE WASM lazy loaded and at or under
  4 MB; Lighthouse performance at or above 0.8 and accessibility and best
  practices at or above 0.9 on the built PWA (lighthouserc.json, Phase 2 on).
- Dependency hygiene (hard gate): no high or critical production
  vulnerabilities (`pnpm audit:prod`).
- Offline: the PWA must load and operate against cached kernels with no network,
  once a kernel bundle has been cached.
- Accessibility: keyboard navigation for all primary controls; the object
  browser and timeline operable without a pointer; the e2e axe scan reports
  zero serious or critical violations (Phase 2 on).
- Portability: identical visual results across the three targets for the same
  catalog and epoch, within rendering tolerance.
- Licensing: Apache-2.0 (LICENSE at the repo root); all dependencies
  license-compatible; CSPICE usage consistent with NAIF terms.
- Security: no secrets in the repo; .claudeignore enforces this for agent
  sessions; kernel and catalog files are treated as untrusted input
  (SECURITY.md); kernel proxy, if deployed, is read-only and CORS-scoped.
- Releases: changesets-driven versioning and changelogs; maturity expressed
  through alpha, beta, and stable channels (ADR-0009).

---

## 11. Open decisions (carried forward, to confirm)

These were open at the end of prior Bessel work and are recorded here so the
implementation does not silently pick an answer. Defaults proposed in brackets.

1. Governance home: personal, JPL via NASA-AMMOS, or independent with JPL
   collaboration. [NASA-AMMOS GitHub organization.]
2. Kernel hosting for the web target: companion proxy, PDS NAIF mirror with CORS
   handling, or user-uploaded only. [Companion read-only proxy plus OPFS cache,
   with drag-and-drop as fallback. ADR-0005.]
3. CesiumJS: embed a Cesium globe, or interoperate via CZML and defer surface to
   MMGIS. [Interoperate via CZML; do not embed. ADR-0002 scope note.]
4. Compatibility target: 100 percent Cosmographia catalog fidelity or 80 percent
   core with documented gaps. [80 percent core in v1, with a documented
   compatibility matrix; pursue full fidelity opportunistically. ADR-0006.]
5. WebGPU timeline: start on WebGL2 and migrate, or build on WebGPURenderer now.
   [WebGL2 first, design the renderer behind an abstraction to allow migration.
   ADR-0003.]
6. Naming: "Bessel" is the working title; alternatives noted in prior work.
   [Keep Bessel unless trademark or endorsement concerns arise.]

---

## 12. Traceability

The suite
integration contracts live in docs/integrations.md (ADR-0008); the production
baseline (CI, budgets, releases, governance) is ADR-0009 with its configs at
the repo root. ADRs in
docs/adr/ are referenced inline above by id. The verifiable command catalog in
Section 8 is duplicated in CLAUDE.md so the agent has it in-session. Changes to
acceptance criteria must update both this document and the corresponding goal
file.
