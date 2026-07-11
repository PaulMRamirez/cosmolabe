# Bessel vs Cosmographia: Parity Matrix

Status: Draft v1.4 (analysis-engine refresh)
Date: 2026-06-22

> Scope: this matrix tracks parity against the **Cosmographia visualizer** only.
> The separate STK-class mission-analysis engine layer (propagation, access,
> lighting, communications, conjunction, attitude, coverage, maneuver design,
> interop) landed afterward and is tracked in docs/STK_PARITY_SPEC.md §9; rows
> below that touch analysis or scripting cross-reference it rather than
> duplicating that tracking. Those analysis-engine capabilities are now surfaced
> in the task-framed six-tab Analyze workbench (see docs/analysis-workbench.md and
> STK_PARITY_SPEC §9), not the old flat analysis panel.

> Closure pass (2026-06-14): the Section 15 closure plan was executed. The
> headline gap (arbitrary-mission load into the rendered scene) is closed, image
> textures and CK attitude are wired, the measurement and camera readouts are
> added, and the scripting/plugin/telemetry surface exists as tested core
> capability. The status rows below are updated; honest residuals (content not
> bundled, capabilities not yet surfaced in the shell) are called out per row and
> summarized in Section 15. As of 2026-06-19 all program gates are green
> (typecheck, lint, 711 unit/contract tests, build:web, build:desktop, cap:sync,
> 31 e2e incl. the Electron DSK render and the axe scan, size, audit:prod, lhci,
> release:dry).

This is the auditable, feature-by-feature parity check promised in ADR-0006 and
SPEC.md Section 11. It states *exactly* what Cosmographia does, whether Bessel
has it, and where the evidence is.

Method:
- Cosmographia baseline (the "should match" column) was verified against the
  live User's Guide at cosmoguide.org and the source at
  github.com/claurel/cosmographia in June 2026, not asserted from memory.
  Citations are in the Sources section.
- Bessel status was verified by opening the cited file or commit, not from the
  build report. Where the build report or the project roadmap disagrees with the
  code, the code wins and the disagreement is noted.

Status legend:
- Done: implemented and verifiable in the named file or gate.
- Partial: present but materially narrower than Cosmographia, or built but not
  wired into the running app.
- Missing: not implemented yet (target work).
- By-design: a deliberate Bessel-vs-Cosmographia divergence, not a gap to close.

---

## 1. Parity scorecard

Counts roll up the rows in Sections 2 through 12. "Core viewer parity" is
Sections 2 through 8 (catalog, engine, geometry, rendering, camera, timeline,
measurement); the remaining sections are platform and ecosystem, where Bessel
mostly exceeds the incumbent by design.

Counts after the closure pass (Draft v1.0 values in parentheses where changed):

| Category                         | Done    | Partial | Missing | By-design |
| -------------------------------- | ------- | ------- | ------- | --------- |
| 2. Catalog and data model        | 4 (2)   | 0 (2)   | 0       | 0         |
| 3. SPICE and geometry engine     | 13 (11) | 0       | 0       | 0         |
| 4. Geometry taxonomy (7 types)   | 7 (4)   | 0 (3)   | 0       | 0         |
| 5. Rendering fidelity            | 11 (10) | 1       | 0       | 0         |
| 6. Camera and navigation         | 6 (3)   | 0       | 0 (1)   | 0         |
| 7. Timeline and playback         | 5 (4)   | 0 (1)   | 0       | 0         |
| 8. Analysis and measurement      | 4 (2)   | 0 (1)   | 0 (1)   | 0         |
| 9. Modern UI/UX                  | 7       | 0       | 0       | 0         |
| 10. Platform reach               | 4       | 0       | 0       | 0         |
| 11. Sharing and ops integration  | 6 (4)   | 0       | 0 (2)   | 1         |
| 12. Scripting and extensibility  | 3 (1)   | 0       | 1       | 0         |

Headline reading: core Cosmographia visualizer parity is effectively closed. The
SPICE engine, geometry taxonomy (including ring image textures), rendering (real
runtime-downloaded planetary imagery, CK-driven attitude), camera (arbitrary
SPICE-frame lock, dolly/crane), timeline, measurement, and modern UI/UX are at or
beyond parity, and the scripting console, plugin loader, and telemetry overlay are
wired into the shell. The five-type catalog taxonomy now round-trips in both
directions (`fromCosmographia` + `toCosmographia`, proven by
`cosmographia-roundtrip.test.ts`), closing the last catalog Partial. The handful of
remaining items are narrow or by-design: model reflections are not rendered (shadows
are), the model format is glTF not 3DS/CMOD (by design), and TLE auto-update (niche)
is unbuilt. See Section 15. The geometry engine added two more SPICE finders this
pass (`gfsep`, `gfposc`); the numerical analysis engines (access, events, rf,
coverage, conjunction) deepened well beyond the Cosmographia viewer and are tracked
in the Section 17 appendix, with the coverage-grid contour now rendered on the globe.
Those engines are now fully surfaced in the consolidated analysis workbench (the
analysis-UX re-slot, complete 2026-06-22): six intent-named domain tabs of
collapsible TaskCards over a shared Scenario context, replacing the former flat
AnalysisPanel. See Section 17 and docs/analysis-workbench.md.

---

## 2. Catalog and data model

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| JSON catalog parsing (spacecraft, center, frame, kernels) | Yes, five catalog types (Spacecraft, Sensor, Observation, Natural Body, Catalog List) | Done | `packages/catalog/src/cosmographia.ts` (`fromCosmographia`), `packages/catalog/src/cosmographia-export.ts` (`toCosmographia`), `packages/catalog/src/cosmographia-roundtrip.test.ts` | `fromCosmographia` imports every item type (body, spacecraft, sensor, observation) and all five trajectory forms, four rotation forms, and seven geometry types; `toCosmographia` is its inverse on the lossless subset (Section 16.3). The round-trip test asserts `canonicalize(toCosmographia(fromCosmographia(fixture)))` equals `canonicalize(fixture)`, a native identity property + table test, and a negative test that a lossy construct raises a typed `CatalogWarning`. Cosmographia per-sensor-per-target file *names* are synthesized on re-expansion (By-design, lossless on content; the `CatalogWarning` path makes the loss explicit). |
| Native collapsed schema (fewer files per mission) | No (per-sensor-per-target file explosion) | Done | `packages/catalog/src/native-types.ts`, `validator.ts`, `schema.test.ts` | Bessel advantage: a targets array collapses the Sensor plus Observation file sprawl. |
| Schema validation with explicit located errors | Partial (SPICE error log; silent re-center on missing refs) | Done | `packages/catalog/src/validator.ts` (`CatalogError`), `taxonomy.test.ts` | Bessel advantage: typed, located, loud failures. |
| Load an arbitrary mission into the rendered 3D scene | Yes, load and update catalogs at run time | Done | `apps/web/src/generic-mission.ts`, `apps/web/src/engine/engine.ts` (`loadCatalog`, `loadCatalogUrl`, `uploadKernel`), `packages/scene/src/three-scene.ts` (`reset`) | The app boots into a neutral inner-solar-system scene; no mission is hardcoded. A native catalog rebuilds the rendered scene generically: catalog bodies, spacecraft, trajectory (sampled in the center frame), the seven geometry types, rings, atmosphere, axis triads, direction vectors, the instrument FOV and footprint, and a glTF model all map from catalog data. The Cassini demo now ships as a loadable sample (`apps/web/public/samples/cassini-saturn.json`). An OPFS kernel-upload path supports unbundled kernels. Verified by `generic-mission.test.ts` and the `generic-mission` e2e, and the Cassini-specific e2e (poc, instruments, measure) load the sample. |

## 3. SPICE and geometry engine

All wrapped in a typed Web Worker engine (`packages/spice/src/engine.ts`,
`client.ts`), which is itself a robustness advantage over Cosmographia's
in-process C++ calls.

| Capability | Cosmographia | Bessel status | Evidence |
| --- | --- | --- | --- |
| SPK position and state (spkpos, spkezr) | Yes | Done | `packages/spice/src/engine.ts`; fixture asserts spkpos vs de440 within 1e-3 km (`spice.test.ts`) |
| Aberration correction modes | Yes | Done | engine.ts (NONE, LT, LT+S, CN, CN+S, XLT, XLT+S, XCN, XCN+S) |
| Time conversion (str2et, et2utc, utc2et) | Yes | Done | `packages/spice/src/engine.ts` |
| Frames and rotation (pxform, sxform, SPICE frames) | Yes | Done | engine.ts |
| Field of view (getfov) | Yes | Done | engine.ts; `geometry.test.ts` |
| Surface intercept (sincpt) | Yes | Done | engine.ts |
| Illumination angles (ilumin) | Yes | Done | engine.ts |
| Sub-observer point (subpnt) | Yes | Done | engine.ts |
| Body constants (bodvrd, bodvcd) | Yes | Done | engine.ts |
| DSK Type 2 shape read (readDsk) | Yes | Done | engine.ts; `dsk.test.ts` |
| Kernel I/O via platform-neutral source (furnsh, unload, kclear, ktotal) | Yes (direct filesystem) | Done | engine.ts plus PAL `KernelSource` (`packages/pal-*`) |
| Angular-separation finder (gfsep) | Yes | Done | `packages/spice/src/bindings.ts` (`gfsep`), `engine.ts`; `geometry-finder.test.ts` validates intervals against an independent `vsep` and fails loud on a bad body |
| Coordinate finder (gfposc, topocentric elevation) | Yes | Done | `packages/spice/src/bindings.ts` (`gfposc`), `engine.ts`; `geometry-finder.test.ts` validates latitudinal-latitude (elevation) crossing intervals |

## 4. Geometry taxonomy (the seven types)

| Type | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Mesh (spacecraft, small bodies) | 3DS and CMOD models | Partial | `packages/scene/src/spacecraft-model.ts`, `apps/web/src/assets/cassini.gltf` | Bessel uses glTF, not 3DS/CMOD. Functionally equivalent; format compatibility differs. |
| SPICE DSK (Type 2 triangular plate) | Yes (4.1+) | Done | `packages/scene/src/dsk-mesh.ts`; `packages/spice/src/dsk.test.ts`; `e2e/tests/electron-dsk.spec.ts` | DSK read (the type-2 wasm exports are linked: `dasopr`, `dascls`, `dskz02`, `dskv02`, `dskp02`), mesh build, and the end-to-end Electron render are all green (the Electron e2e asserts >100 real plates and a non-empty frame). |
| Globe (sphere or ellipsoid) | baseMap, normalMap, cloudMap, atmosphere textures | Done | `packages/scene/src/body-material.ts`, `planets.ts`, `atmosphere.ts` | Globes now use an image base-map (and normal map) when the catalog declares one, falling back to the procedural texture otherwise; Rayleigh atmosphere shell present. Cloud-map not yet. Tested by `body-material.test.ts`. Residual: real hi-res image assets are not bundled (content task). |
| Rings | Textured annulus | Done | `packages/scene/src/rings.ts`, `generic-mission.ts` (`ringSpecFromGeometry`), `rings.test.ts` | The ring mesh now samples a catalog image texture mapped as Cosmographia does it (the v=0 radial strip: inner UV (0,0), outer UV (1,0), clamp wrap, PNG alpha driving gaps); the procedural banded fallback (with a real Cassini-Division gap) remains when no image is supplied. |
| ParticleSystem (plumes, jets, exhaust) | Yes | Done | `packages/scene/src/particle-system.ts`; `particle-system.test.ts` | Deterministic emission. |
| KeplerianSwarm (belts, debris) | Yes (astorb data) | Done | `packages/scene/src/keplerian-swarm.ts`; `keplerian-swarm.test.ts` |
| TimeSwitched (geometry varying over time) | Yes | Done | `packages/scene/src/time-switched.ts`; `time-switched.test.ts` |

## 5. Rendering fidelity

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| High-resolution image textures (multithread auto-download) | Yes | Done | `packages/scene/src/texture-manager.ts`, `apps/web/src/texture-imagery.ts`, `packages/pal-web/src/opfs-cache.ts` | A texture manager fetches real equirectangular planetary basemaps (Solar System Scope / NASA) at runtime behind a toggle, decodes off the first-paint shell, and caches them in OPFS via the PAL (mirroring kernel caching); base/normal/night/specular/cloud maps load from the catalog with Cosmographia field parity; the procedural texture is the loud-fail fallback. Bessel advantage: imagery is fetched on demand, not bundled. |
| Realistic atmospheres | Yes | Done | `packages/scene/src/atmosphere.ts`, `shaders/` | Rayleigh scattering shell. |
| Shadows and reflections on models | Yes | Partial | `packages/scene/src/shadows.ts` | Sun-light shadow mapping present; reflections not. |
| Realistic star field from a catalog | Yes | Done | `packages/scene/src/star-field.ts`, `star-catalog.ts`, `apps/web/src/assets/bright-stars.json` |
| Object labels | Yes | Done | `packages/scene/src/labels.ts`; `labels.test.ts` |
| Reference frame axis triads | Yes | Done | `packages/scene/src/axis-triad.ts` |
| Direction vectors (to Sun, Earth, velocity) | Yes (showDirectionVector) | Done | `packages/scene/src/direction-vectors.ts` |
| FOV sensor cones | Yes | Done | scene plus `apps/web/src/instruments.ts` (`fovRim`); FOV e2e green |
| Observation footprints (swath and discrete) | Yes (obsRate swath) | Done | `apps/web/src/instruments.ts` (`footprint`); footprint e2e green |
| Spacecraft attitude from CK | Yes | Done | `packages/spice/src` (`ckw03`/`ckgp`/`sce2c` bindings), `packages/scene/src/orientation.ts` (`applyAttitude`), `kernels/fixtures/cassini-demo.bc` | CSPICE-WASM now exports the CK entry points (relinked via `pnpm cspice:build`); the engine writes and reads C-kernels, and the bundled Cassini demo furnishes a real CK + SCLK + FK and orients the model each frame from `pxform(scFrame, J2000)`. Validated by a write/`ckgp`/`pxform` round-trip against `q2m`. |
| Camera-relative (floating origin) at solar-system scale | Yes | Done | `packages/scene/src/three-scene.ts`, `camera-modes.ts` | Mandatory per SPEC 5.1. |
| Coverage-grid contour overlay on the globe | No (Cosmographia is a viewer) | Done | `packages/scene/src/coverage-overlay.ts`, `colormap.ts`; `apps/web/src/engine/analysis-ops.ts` (`sweepCoverage` -> `scene.setCoverageOverlay`), the `CoveragePanel` Coverage sweep card (`apps/web/src/panels/CoveragePanel.tsx`); `coverage-overlay-scene.test.ts`, `analysis-panel.test.tsx` | Bessel advantage: a vertex-colored, camera-relative coverage overlay anchored to the focus body, fed by a `@bessel/coverage` grid sweep. |

## 6. Camera and navigation

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Select an object (click to pick) | Yes | Done | `packages/scene/src/picking.ts`; `picking.test.ts` |
| Set an object as center | Yes | Done | `packages/scene/src/camera-modes.ts` (center mode) |
| Orbit and track the camera | Yes | Done | `camera-modes.ts` (orbit, track) | Track mode is a Bessel convenience. |
| Select a rendering frame | Yes | Done | `packages/scene/src/camera-modes.ts`, `packages/ui/src/CameraFrameControls.tsx` | Orbit/center/track plus an arbitrary SPICE-frame lock: the camera orbit basis is oriented via `pxform(frame, J2000)` for any furnished frame (e.g. IAU_EARTH or a mission frame), camera-relative. |
| Move the camera (pan, dolly, crane) | Yes | Done | `packages/scene/src/camera-modes.ts`, `camera-controller.ts` | Orbit controls plus dolly (translate along the view axis) and crane (vertical translation) verbs, wired into the controls and keymap. |
| Set the view from a vector | Yes (Using a Vector to Set the Camera View) | Done | `packages/scene/src/camera-modes.ts` (`azimuthElevationFromDirection`), `engine.ts` (`viewAlong`, `viewFromSun`, `viewAlongVelocity`), `ui/ViewControls.tsx` | A vector sets the camera azimuth/elevation via the tested inverse of the orbit-camera math; "Sun view" and "Velocity view" buttons drive it. Tested by `camera-modes.test.ts`. |

## 7. Timeline and playback

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Set time | Yes | Done | `packages/timeline/src/`, `packages/ui/src/TimelineControls.tsx` |
| Adjust time rate | Yes | Done | `TimelineControls.tsx` (1x to 604800x) |
| Pause and unpause | Yes | Done | `apps/web/src/engine/engine.ts` (togglePlay) |
| Scrub timeline | Implicit | Done | `TimelineControls.tsx` scrub slider | Bessel convenience. |
| Event annotations on the timeline | Limited | Done | `packages/timeline/src/annotations.ts` (`arcBoundaryAnnotations`), `apps/web/src/engine/mission-annotations.ts`, `TimelineControls.tsx` | Annotations are computed in the engine/mission layer from trajectory arc boundaries plus a SPICE-found closest approach, rendered as clickable timeline markers that scrub the clock; the hard-coded SOI marker is removed. Bessel advantage: the markers are derived, not hand-placed. |

## 8. Analysis and measurement

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Angle between two vectors | Yes (deg and rad, 4.0+) | Done | `packages/ui/src/MeasurePanel.tsx` (angular separation) |
| Distance between two objects | Yes (km plus relative speed km/s) | Done | `MeasurePanel.tsx`, `apps/web/src/sampler.ts` (`rangeRate`), `engine.ts` (`updateMeasurement`) | Distance in km and AU, plus range rate (km/s, closing or separating) from the line-of-sight component of relative velocity. Tested by `sampler.test.ts`. |
| Altitude above a body surface | Yes (km) | Done | `apps/web/src/readouts.ts`, `ui/ReadoutPanel.tsx` | Surface altitude (range minus the PCK mean radius from bodvrd) shown in the readout panel. |
| Geometric readouts (range, phase, incidence, emission) | Partial (distance, altitude, speed) | Done | `packages/ui/src/ReadoutPanel.tsx`, `apps/web/src/readouts.ts` | Bessel advantage: richer illumination readouts via ilumin. |

## 9. Modern UI/UX (Bessel net advantage)

| Capability | Cosmographia | Bessel status | Evidence |
| --- | --- | --- | --- |
| Object browser with multi-select and visibility | Menu-driven | Done | `packages/ui/src/ObjectBrowser.tsx` |
| Search/filter objects | Limited | Done | `packages/ui/src/SearchBox.tsx` |
| Object inspector panel | Info text boxes | Done | `packages/ui/src/ObjectInspector.tsx` |
| Settings toggles (trajectory, labels, FOV, footprint, axes, stars, atmosphere, shadows) | Settings dialogs | Done | `packages/ui/src/SettingsPanel.tsx` |
| Light/dark theme | No | Done | `packages/ui/src/ThemeToggle.tsx` |
| Keyboard shortcuts plus help overlay | Yes (shortcuts) | Done | `packages/ui/src/keymap.ts`, `KeyboardHelp.tsx`, `useKeyboardShortcuts.ts` |
| Still capture and video recording | Movie recording, screenshots | Done | `packages/ui/src/CaptureControls.tsx`, `capture.ts`; `engine.ts` download |

## 10. Platform reach (Bessel net advantage)

| Capability | Cosmographia | Bessel status | Evidence |
| --- | --- | --- | --- |
| Desktop (Windows, macOS, Linux) | Yes | Done | `apps/desktop`, `packages/pal-electron` |
| Desktop meta-kernel (.tm) path resolution | Yes | Done | `packages/pal-electron/src` (PATH_SYMBOLS/PATH_VALUES) |
| Web / PWA, offline | No | Done | `apps/web`, `packages/pal-web` (OPFS cache, service worker) |
| Mobile (iOS via Capacitor) | No | Done | `apps/mobile`, `packages/pal-capacitor` (Android deferred) |

## 11. Sharing and operations integration

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Shareable view state (URL) | No | Done | `packages/state/src/codec.ts` (round-trip property test) | Bessel advantage. |
| MMGIS deep links | No | Done | `packages/state/src/mmgis.ts` | Bessel advantage. |
| CZML export (CesiumJS) | No | Done | `packages/state/src/czml.ts` | Bessel advantage. |
| Movie and screenshot export | Yes | Done | see Section 9 | Parity. |
| Command-line / batch usage | Yes (Command Line Usage) | Done | `packages/sdk` (`runJob`, `defineJob`, the JSON batch-job IR), `packages/pal-node`, `apps/cli` (the `bessel` bin) | Bessel advantage: a headless, deterministic batch runner executes a schema-validated JSON job (furnish kernels, propagate, run an MCS, analyze, export OEM/CSV) against a Node PAL with CI-grade exit codes, plus a programmatic `defineJob` builder. Tested end to end with the real SPICE engine and an in-memory PAL. |
| Live telemetry overlays (Yamcs, OpenMCT) | No | Done | `packages/state/src/telemetry.ts` (`TelemetryAdapter`), `packages/ui/src/TelemetryOverlay.tsx` | Bessel advantage: an on-screen predicted-versus-actual overlay (two series, a residual line, a clock-tied now-line, and a Yamcs-severity-colored threshold line, with a fault banner) backed by the transport-neutral adapter, grounded in OpenMCT/Yamcs conventions. Residual: the demo transport is a mock socket, swappable for a live Yamcs/OpenMCT WebSocket. |
| Surface GIS context | Built in | By-design | `mmgis.ts` | Deferred to MMGIS by deep link rather than embedded (ADR rationale). |

## 12. Scripting and extensibility

| Capability | Cosmographia | Bessel status | Evidence | Gap / note |
| --- | --- | --- | --- | --- |
| Scripting of the running app | Yes (cosmoscripting `Cosmo()`: gotoObject, setTime, setTimeRate, pause, show*) | Done | `apps/web/src/scripting.ts` (`BesselScript`), `apps/web/src/script-runner.ts`, `packages/ui/src/ScriptConsole.tsx` | A `Script` menu surfaces an in-app console that runs a BesselScript program (a no-eval line grammar with a verb allowlist and per-line loud errors) against the live engine, with the cosmoscripting-parity verb set (gotoObject, setTimeRate, track, setFrame, show/hide, screenshot, record, note, loadCatalog, etc.). The desktop `runBatchGeometry` Python bridge also remains. |
| Mission plugin modules (JUICE-style) | Yes (plugin precedent) | Done | `packages/catalog/src/plugins.ts` (`PluginRegistry`), `apps/web/src/panels/PluginsPanel.tsx`, `apps/web/src/engine/load-mission.ts` | A `Plugins` menu lists registered plugins and loads one, furnishing its declared kernels in Cosmographia add-on order (SPICE data before objects) via the PAL KernelSource, verifying frames, rendering the catalog, and offering Unload. A real Cassini fixture plugin ships bundled. |
| OSS governance, contribution path | Source published, not a living project | Done | repository, Apache-2.0 | Bessel advantage. |
| Two-line element auto-update | Yes | Missing | not found | Niche; low priority. |

---

## 13. Where Bessel is already better

These are not parity rows; they are the reasons Bessel is a modernization, not a
clone:
- Tri-target delivery from one codebase: web/PWA, iOS, and desktop, against
  Cosmographia's desktop-only reach (Section 10).
- Loud, located, typed errors (`SpiceError`, `CatalogError`, `PalError`) instead
  of the silent "jump to the Sun" on a missing reference (Section 2).
- Shareable URL view state, MMGIS deep links, and CZML export: an operations and
  interchange surface Cosmographia has none of (Section 11).
- Collapsed instrument schema that removes the per-sensor-per-target file
  explosion (Section 2).
- Web Worker isolation of CSPICE and mandatory camera-relative rendering as
  designed-in properties (Sections 3 and 5).
- Modern UI affordances: search, theming, dockable panels, inspector, richer
  illumination readouts (Sections 8 and 9).
- A numerical mission-analysis backend that Cosmographia, a pure viewer, has no
  equivalent of: special-perturbations propagation (adaptive DOPRI5 Cowell with NxN
  gravity, drag, and SRP) with dense output, switching-function event detection, and
  a co-integrated State Transition Matrix; an Astrogator-class Mission Control
  Sequence executor with a differential corrector, nested targeting, and finite
  burns; orbit determination (batch least-squares and an EKF); the EOP-aware TEME to
  J2000 transform; and the headless automation SDK and `bessel` batch runner
  (Section 11). See docs/STK_PARITY_SPEC.md for the analysis-layer requirements.

## 14. Known divergences (by design, not gaps)

- Model format: glTF rather than 3DS/CMOD.
- Surface GIS: deep-linked to MMGIS rather than embedded.
- Catalog: a native collapsed schema is the primary format; Cosmographia
  compatibility is an 80 percent core target with a documented round trip
  (ADR-0006), not 100 percent fidelity.

## 15. Closure plan: status

Executed on 2026-06-14. Status per item, with honest residuals.

1. Arbitrary-mission load into the rendered scene. DONE. `generic-mission.ts`
   builds a SceneSpec from any native catalog (bodies, spacecraft, trajectory in
   the center frame, and the seven geometry types); `engine.loadCatalog` resets
   and rebuilds the scene; the frame loop is mission-driven via `MissionIdentity`
   (no Cassini hardcode); `engine.uploadKernel` furnishes unbundled kernels via
   OPFS. Verified by `generic-mission.test.ts` and the `generic-mission` e2e.
   Flipped Section 2 row 4 to Done.

2. Image-based rendering fidelity. DONE (capability). `body-material.ts` loads an
   image base-map and normal map when a catalog declares them, with a procedural
   fallback; the catalog `texture`/`normalMap` are plumbed through. Tested by
   `body-material.test.ts`. Residual: hi-res NASA texture assets are not bundled,
   and ring meshes still ignore the ring image (Section 4 Rings stays Partial).

3. CK attitude. DONE (capability). `applyAttitude` plus per-frame
   `pxform(scFrame, J2000)` sampling orient the model; tested by
   `orientation.test.ts`. Residual: real only when a CK kernel covers the epoch
   (none bundled), so Section 5 CK stays Partial pending a CK fixture.

4. DSK end-to-end in the app. DONE. The DSK type-2 wasm exports are linked,
   `readDsk` is exercised against the mu69 fixture (`dsk.test.ts`), and the
   Electron e2e renders the DSK body (>100 plates, non-empty frame). Flipped
   Section 4 DSK to Done.

5. Readouts and vector-set-view. DONE. Range rate (`rangeRate`, tested), surface
   altitude (bodvrd radii), and vector-to-set-view (`azimuthElevationFromDirection`
   with Sun/Velocity buttons, tested). Flipped the Section 8 measurement rows and
   the Section 6 vector-set-view row to Done. Residual: shadow/ring shader polish
   not pursued.

6. Scripting, plugins, telemetry. DONE (capability). `BesselScript` (cosmoscripting
   verbs), `PluginRegistry` (lazy plugin loading), and `TelemetryAdapter`
   (predicted-versus-actual from a WebSocket-like source), each unit-tested.
   Residual: none is surfaced in the shell UI or wired to a live server yet, so
   Sections 11 and 12 move to Partial, not Done.

7. GA hardening. DONE for the gated part. `release:dry` now exits 0 (a changeset
   was added under `.changeset/`); CONTRIBUTING/SECURITY/CODE_OF_CONDUCT already
   exist; the axe e2e and `lhci` are green.

Net: every program gate is green and the headline capability gaps are closed.

Residual follow-up DONE (2026-06-14): the documented residuals were closed.
- Textures: the ring mesh now honors a ring image; small real PNG assets ship
  (`apps/web/public/samples/textures/`, generated by
  `apps/web/scripts/make-sample-textures.mjs`) and the Cassini sample references
  them, so the image path runs end to end (procedural fallback retained). These
  are simple procedural images, not photography.
- Attitude: `Fixed` and `UniformRotation` orientations are supported and applied
  each frame; the Cassini sample spins via UniformRotation, so attitude is
  visibly catalog-driven without needing a CK kernel (the CK/pxform path still
  applies when a CK is loaded).
- Surfacing: an Operations panel exposes the scripting API (a guided tour), the
  mission `PluginRegistry` (a missions list, lazily activated), and the
  `TelemetryAdapter` (a predicted-versus-actual residual from an in-app mock
  feed); covered by `operations-surface` e2e.
- Cosmetic hardcodes removed: "Center on" targets come from the loaded mission;
  shadows size to the focus body's radius.

What is still genuinely not present (by nature, not capability): real
photographic textures and a real CK kernel/SCLK fixture (the sample uses a
procedural spin), and a live Yamcs/OpenMCT server (the telemetry feed is an
in-app mock).

Cosmographia-parity push DONE (2026-06-19, four parallel tracks, grounded by a
research workflow against cosmoguide.org and the claurel/cosmographia source; all
program gates green, 667 unit and 31 e2e including the axe scan):
- Ring image textures: the ring mesh now samples a catalog image as Cosmographia
  does (v=0 radial strip, clamp wrap, PNG-alpha gaps), with the procedural banded
  fallback retained. Section 4 Rings to Done.
- Body materials: night (emissive), specular (metalness/roughness), and a cloud
  shell join the base/normal maps, all from the catalog with Cosmographia field
  parity, and a generator writes small textures into `public/textures/`. Section 5
  hi-res textures stays Partial only for the unbundled real NASA basemaps and the
  auto-download manager.
- Scripting console: a `Script` menu runs a BesselScript program (no-eval line
  grammar, verb allowlist, per-line loud errors) against the live engine with the
  cosmoscripting-parity verb set. Section 12 Scripting to Done.
- Plugin loader: a `Plugins` menu loads a registered plugin, furnishing kernels in
  Cosmographia add-on order (SPICE data before objects) and rendering it. Section 12
  plugin modules to Done.
- Timeline annotations: derived in the engine from arc boundaries plus a SPICE-found
  closest approach, rendered as clickable markers (SOI hardcode removed). Section 7
  to Done.
- Telemetry overlay: an on-screen predicted-versus-actual overlay (two series,
  residual, clock-tied now-line, Yamcs-severity threshold, fault banner), grounded in
  OpenMCT/Yamcs conventions. Section 11 to Done.
- Attitude: bundled-demo attitude is now real via a UniformRotation orientation; the
  CK-binary read still needs the `ck*`/`sce2c` CSPICE-WASM exports linked.

Final parity push DONE (2026-06-19, three parallel tracks, all gates green, 711 unit
and 31 e2e): the last visible viewer-parity gaps closed.
- CK-binary attitude: CSPICE-WASM was relinked (`pnpm cspice:build`) to export
  `ckw03`/`ckopn`/`ckcls`/`ckgp`/`sce2c`/`sct2e`; the engine writes and reads
  C-kernels and the Cassini demo furnishes a real CK + SCLK + FK, validated by a
  write/`ckgp`/`pxform` round-trip against `q2m`. Section 5 CK attitude to Done.
- Real planetary imagery: a runtime texture manager fetches real equirectangular
  basemaps (Solar System Scope / NASA) behind a toggle and OPFS-caches them via the
  PAL, decoded off the first-paint shell. Section 5 hi-res textures to Done.
- Camera: an arbitrary SPICE-frame lock (orient the orbit basis via `pxform`) and
  dolly/crane motion verbs. Section 6 both rows to Done.
- (Analysis, separate track but same batch: a Jacchia-1971 density model, an SQP MCS
  optimizer, and OD Bennett refraction + state-noise compensation; see
  docs/STK_PARITY_SPEC.md Section 9.)

What is still genuinely not present: model reflections (shadows are rendered), the
full five-type Cosmographia catalog taxonomy (ADR-0006 80 percent target), 3DS/CMOD
mesh formats (glTF by design), and TLE auto-update (niche).

---

---

## 16. Catalog data-model coverage and full Cosmographia round-trip

> Status: Design, 2026-06-21. This section is the implementation-ready design for
> closing the catalog data-model gaps and reaching a full bidirectional
> Cosmographia round-trip (import and export). It supersedes the ADR-0006 "80
> percent core" framing for the catalog row only: ADR-0006 stays the binding
> decision record; this is the plan to push the catalog data model toward Done.
> No em dashes (CLAUDE.md). All references are code-verified against the files
> named below.

### 16.1 Current model-level gaps (verified)

The viewer-parity closure (Section 15) closed the *rendering* path for native
catalogs. What remains is a **data-model** gap: several declared trajectory and
orientation shapes cannot carry their own parameters, the schema and its TS
mirror disagree on the type names, the Cosmographia importer is single-item and
Spice-only, and there is no exporter at all. Concretely:

1. **Trajectory is a stub.** `packages/catalog/schema/bessel-catalog.schema.json`
   `$defs.trajectory` is `{ type: enum(Spice|Keplerian|Fixed|Sampled), center?,
   frame? }` with `additionalProperties:false`. So a `Keplerian` trajectory cannot
   carry elements, a `Fixed` trajectory cannot carry a position, and a `Sampled`
   trajectory cannot carry a sample source. Only `Spice` is usable today.

2. **Schema and TS mirror drift.** `native-types.ts` `Trajectory.type` is
   `Spice | Keplerian | InterpolatedStates | FixedPoint`; the schema enum is
   `Spice | Keplerian | Fixed | Sampled`. The names `FixedPoint`/`InterpolatedStates`
   (TS) versus `Fixed`/`Sampled` (schema) do not match, so a catalog that validates
   may not typecheck and vice versa. The schema is the source of truth (validation
   runs against it), so the TS side is the one in error.

3. **TwoVector orientation has no parameters.** Both the schema `$defs.orientation`
   and the TS `Orientation` list `TwoVector` in the enum, but neither carries the
   primary/secondary axis-and-target fields the construct needs. It is undeclarable.

4. **Importer is single-item and Spice-only.** `cosmographia.ts`
   `parseCosmographiaCatalog` does `items.findIndex(... first spacecraft ...)` and
   returns a flat `SpacecraftCatalog` for that one item with a hard
   `trajectory.type !== 'Spice'` rejection. `cosmographiaGeometryToNative` (Globe,
   Rings) exists but is never called from a multi-item import. There is no path that
   turns a Cosmographia file with N bodies + spacecraft + geometry + rotationModel +
   instruments into a `BesselCatalog`.

5. **No exporter.** There is no `toCosmographia`, so there is no round-trip and no
   round-trip test. Compatibility is import-only and lossy.

6. **Per-item visual config not honored.** `trajectoryPlot` (lead/trail/duration/
   color/fade/sampleCount) and per-item `label` (text/color/show) are in the schema
   on `body` and `spacecraft`, but `native-types.ts` `CatalogBody`/`CatalogSpacecraft`
   omit both fields and `generic-mission.ts` synthesizes its own trajectory color
   ramp and labels, ignoring the catalog's. The declared visual intent is dropped.

7. **Cosmographia input renders nothing.** `apps/web/src/catalog-load.ts` routes
   Cosmographia input to `parseCosmographiaCatalog` and returns a one-entry list;
   only `kind === 'native'` carries a `catalog` for `renderNativeMission`. So a
   dropped Cosmographia file never reaches the scene builder.

### 16.2 Field-level coverage table

Cosmographia construct names follow the cosmoguide.org catalog reference. "Status"
is the **target** after this section's work lands; the current state is in 16.1.

| Cosmographia construct | Bessel native equivalent | Status (target) | Note |
| --- | --- | --- | --- |
| `trajectory.type = "Spice"` (target, center, frame) | `Trajectory{ type:'Spice', target, center, frame }` | Done (today) | Already sampled via `spkpos`/`spkezr` in `sampler.ts`. Add explicit `target` field (today the spacecraft `id` carries it). |
| `trajectory.type = "InterpolatedStates"` / sampled states | `Trajectory{ type:'Sampled', source, frame, center }` | New | Sample table from a referenced states source (XYZ/OEM-like). Wire to an in-memory sampler; SPICE not required. |
| `trajectory.type = "Keplerian"` (period, sma, ecc, inc, raan, argp, M0, epoch) | `Trajectory{ type:'Keplerian', elements:{ a,e,i,raan,argp,m0,epoch }, center, frame, mu? }` | New | Wire to `@bessel/propagator` `propagateMeanElements` (CSPICE `conics`), reuses the existing Kepler math. |
| `trajectory.type = "TLE"` / two-line element | `Trajectory{ type:'Tle', line1, line2, center?, frame? }` | New | Wire to `parseTle` + `sgp4init`/`sgp4` (TEME), rotate with `temeToJ2000AtEt`. Earth-centric. |
| `trajectory.type = "FixedPoint"` (position) | `Trajectory{ type:'Fixed', position:[x,y,z], center, frame }` | New | Constant position; no propagation. Landmarks, fixed stations. |
| `rotationModel.type = "Spice"` (frame) | `Orientation{ type:'Spice', frame }` | Done | `bodyRotation`/`resolveAttitude` consume it via `pxform`. |
| `rotationModel.type = "Fixed"` (quaternion) | `Orientation{ type:'Fixed', quaternion }` | Done | `resolveAttitude` kind `fixed`. |
| `rotationModel.type = "UniformRotation"` (axis, rate, epoch) | `Orientation{ type:'UniformRotation', axis, ratePerSec, epoch }` | Done | `resolveAttitude` kind `uniform`. |
| `rotationModel.type = "TwoVector"` (primary/secondary axis + target) | `Orientation{ type:'TwoVector', primary, secondary }` | New | Add axis/target params; resolve both directions via SPICE, build the basis, hand a quaternion to the attitude path. |
| `geometry.type = "Globe"` (baseMap, normalMap, nightTexture, cloudMap, specular, atmosphere) | `Geometry{ type:'Globe', ... }` | Done | `cosmographiaGeometryToNative` maps `baseMap`->`texture` and the rest; rendered by `body-material.ts`. |
| `geometry.type = "RingSystem"` (inner/outer/texture) | `Geometry{ type:'Rings', innerRadius, outerRadius, texture }` | Done | `cosmographiaGeometryToNative` + `ringSpecFromGeometry`. |
| `geometry.type` Mesh / DSK / ParticleSystem / KeplerianSwarm / TimeSwitched | matching native geometry `$defs` | Partial->Done | TS types and renderers exist; importer must map them (today only Globe/Rings are mapped). |
| `label` (color, fadeSize/visibility) | `label{ text, color, show }` | New | Add to `CatalogBody`/`CatalogSpacecraft` TS; honor in `generic-mission.ts` label build. |
| `trajectoryPlot` (lead, trail, duration, sampleCount, color, fade) | `trajectoryPlot{ ... }` (schema has it) | New (wire) | Add to TS body/spacecraft; honor lead/trail/color/sampleCount in the trajectory polyline build. |
| Sensor catalog (`sensor`, `frame`, FOV shape/angles, range, target) | `instrument{ id, parent, sensor, targets, fov }` | Done (import new) | TS + renderer exist; importer must read the per-sensor files into the `targets`-array collapse. |
| Observation catalog (intervals, footprint color) | `observation{ instrument, target, intervals, footprintColor }` | Done (import new) | TS + renderer exist; importer must map. |
| Catalog List (multi-file include) | flattened into one `BesselCatalog` | New | Importer resolves includes and merges items. |

### 16.3 Target end-state

**Full bidirectional round-trip.** `fromCosmographia(raw) -> BesselCatalog` and
`toCosmographia(catalog) -> CosmographiaCatalog`, with a property/fixture test
asserting that on the **lossless subset** the round-trip
`cosmo -> native -> cosmo` is identity up to canonical key ordering and unit
normalization.

**Lossless subset (round-trips exactly):**
- Items: body and spacecraft with `id`/`name`.
- Trajectory: `Spice`, `Keplerian`, `Tle`, `Fixed`, `Sampled` (all five names map
  1:1 in both directions).
- Orientation: `Spice`, `Fixed`, `UniformRotation`, `TwoVector`.
- Geometry: `Globe`, `Rings`, `Mesh`, `DSK`, `ParticleSystem`, `KeplerianSwarm`,
  `TimeSwitched`.
- `label`, `trajectoryPlot`, `mass` (string and object forms), and the
  `instrument` + `observation` collapse.

**Documented lossy constructs (asserted lossy, not silently dropped):**
- Cosmographia per-sensor-per-target file explosion collapses into one
  `instrument.targets` array: exporting re-expands deterministically but file
  *names* are synthesized, not preserved. Lossy on filenames, lossless on content.
- Cosmographia visual fields with no native equivalent (e.g. unmodeled shader
  knobs) are recorded in a `besselExtra`/passthrough bag on export and re-emitted on
  import, or, if dropped, logged via a typed `CatalogWarning` so loss is explicit.
- Atmosphere remains permissive (schema `geometryGlobe.atmosphere` is an open
  object); its sub-fields round-trip verbatim through the passthrough bag.

### 16.4 Implementation-ready design (items 1-5 + export)

#### Item 1: reconcile schema <-> TS trajectory/orientation names

Pick the **schema names as canonical** (schema is the validation source of truth).
- Schema `trajectory.type` enum stays `Spice | Keplerian | Tle | Fixed | Sampled`
  (add `Tle`).
- `native-types.ts` `Trajectory.type` changes `InterpolatedStates -> Sampled` and
  `FixedPoint -> Fixed`, adds `Tle`. Grep for the old names across the workspace
  (`InterpolatedStates`, `FixedPoint`) and update consumers; none are referenced in
  `generic-mission.ts` today, so the blast radius is the type and any test fixtures.
- Add a `schema.test.ts` assertion that every TS `Trajectory['type']` /
  `Orientation['type']` union member equals a schema enum member (a compile-time
  + runtime cross-check, so future drift fails the gate).

#### Item 2: TLE trajectory (model + wire sgp4)

Schema `$defs.trajectory` gains, under a `Tle` discriminant:
```jsonc
{ "type": "Tle", "line1": "string", "line2": "string",
  "center": { "$ref": "#/$defs/id" }, "frame": { "type": "string" } }
```
TS:
```ts
| { readonly type: 'Tle'; readonly line1: string; readonly line2: string;
    readonly center?: string; readonly frame?: string }
```
Wiring (new `apps/web/src/trajectory/tle.ts`, called from the scene builder, not
in core, to keep the layering rule): `parseTle(line1,line2)` -> `sgp4init` ->
for each sample epoch `sgp4(rec, (et - epochEt)/60)` gives a TEME state, then
`temeToJ2000AtEt(state, et)` (from `@bessel/propagator` frames) rotates it into
J2000, expressed relative to Earth (`center` default `EARTH`/`399`). Output a flat
`[x,y,z]` table in the same shape `EphemerisTable.byBody` expects, so the polyline
and centering reuse the existing path. SGP4 epoch comes from `Tle.epochUtc` via
`spice.str2et`.

#### Item 3: Keplerian + Fixed + Sampled trajectory params (wire conics/interp)

Schema `$defs.trajectory` becomes a `oneOf` discriminated union (replacing the
stub), one branch per type, each `additionalProperties:false`:
- `Keplerian`: `{ type, elements:{ a,e,i,raan,argp,m0,epoch }, center, frame, mu? }`
  where angles are radians and `epoch` is UTC; `a` km. Reuse `$defs` for the
  element block.
- `Fixed`: `{ type, position:[x,y,z], center, frame }` (km in `frame`).
- `Sampled`: `{ type, source, format?, center, frame }` where `source` is a
  PAL-resolvable URL to a states table (XYZ rows or OEM); `format` enum
  `xyz|oem`.
- `Spice`: `{ type, target?, center, frame }` (unchanged plus optional `target`).

TS mirrors each branch as a discriminated union member (`Trajectory` becomes a
union, not a single interface; `Arc.trajectory` and body/spacecraft `trajectory`
already reference it).

Wiring:
- **Keplerian** -> `@bessel/propagator` `propagateMeanElements(spice, el, body,
  etGrid, frame)` where `el: ClassicalElements` is the catalog elements (with
  `epoch` converted via `str2et`) and `body: CentralBody` is `{ gm, j2:0, re:0 }`
  (two-body unless J2 is later declared); `mu` from the catalog or `bodvrd(center,
  'GM')`. It already returns a propagator `EphemerisTable`; adapt rows into the
  app `EphemerisTable` shape.
- **Fixed** -> emit the constant `position` for every sample epoch (no SPICE).
- **Sampled** -> fetch via the PAL `KernelSource`/`FileSystem` (never read bytes
  directly, per the architecture rule), parse XYZ/OEM into a states table, and
  interpolate with the existing `positionAt` Hermite/linear path.

A new `apps/web/src/trajectory/index.ts` exposes
`sampleTrajectory(spice, pal, trajectory, etGrid, center): Promise<Float64Array>`
that switches on `trajectory.type` and returns the flat table. `generic-mission.ts`
calls this **instead of** unconditionally `sampleEphemeris`-by-NAIF-id, so non-SPICE
trajectories finally reach the scene. SPICE remains the path for `type:'Spice'`.

#### Item 4: full `fromCosmographia` importer

New `fromCosmographia(raw): BesselCatalog` in `cosmographia.ts` (the existing
single-item `parseCosmographiaCatalog` stays for back-compat / the quick-entry
path). It:
1. Resolves Catalog-List includes (merge `items` across referenced files; for the
   web path, includes are pre-bundled or rejected loudly).
2. Iterates **all** items, classifying each by `class` into `bodies` vs
   `spacecraft` (default: has `geometry.Globe`/no trajectory -> body; has a
   trajectory -> spacecraft).
3. Maps each item's `trajectory` through a new `cosmographiaTrajectoryToNative`
   covering all five types (Spice/Keplerian/Tle/Fixed/Sampled), not just Spice.
4. Maps `rotationModel` -> `Orientation` (all four types incl. TwoVector).
5. Maps `geometry` through `cosmographiaGeometryToNative`, extended to Mesh/DSK/
   ParticleSystem/KeplerianSwarm/TimeSwitched (today only Globe/Rings).
6. Reads Sensor + Observation catalogs into `instruments[]` (collapsing
   per-sensor-per-target files into the `targets` array) and `observations[]`.
7. Carries `label`, `trajectoryPlot`, and `mass` per item.
8. Validates the assembled object against the schema (`parseBesselCatalog`) so the
   importer output is guaranteed schema-valid, and fails loudly with a located
   `CatalogError` on any bad reference.

`catalog-load.ts` changes: `parseAnyCatalog` routes Cosmographia input through
`fromCosmographia` and returns `{ kind:'cosmographia', entries:
nativeEntries(catalog), catalog }` so Cosmographia files now carry a `catalog` and
reach `renderNativeMission` exactly like native ones.

#### Item 5: honor `trajectoryPlot` + `label`, and TwoVector params

- TS: add `readonly label?: Label` and `readonly trajectoryPlot?: TrajectoryPlot`
  to `CatalogBody` and `CatalogSpacecraft`, mirroring the schema `$defs`.
- `generic-mission.ts`: replace the hardcoded color ramp with the catalog
  `trajectoryPlot.color`/`fade` when present; bound the polyline by `lead`/`trail`/
  `duration` around the cursor epoch; use `sampleCount` for the polyline density.
  Replace the synthesized `labels` array entries with the catalog `label.text`/
  `color`, honoring `show:false` (omit the label).
- TwoVector: add `primary`/`secondary` `{ axis:[x,y,z], target?:id, frame? }` to the
  schema and TS `Orientation`. In a new `resolveTwoVector` (scene side), resolve the
  two direction vectors via `spkpos`/`pxform`, Gram-Schmidt them into an orthonormal
  basis, convert to a quaternion, and feed the existing `kind:'fixed'`-style
  attitude path per epoch (or a small per-frame evaluator if it must track).

#### Export: `toCosmographia` + round-trip

New `toCosmographia(catalog: BesselCatalog): CosmographiaCatalog` in
`cosmographia.ts`, the inverse of `fromCosmographia` on the lossless subset:
- Emit one Cosmographia item per body/spacecraft with `class`, `name`,
  `startTime`/`endTime` from the first arc, the trajectory (reversing each of the
  five type maps), `rotationModel`, `geometry` (reversing the geometry maps,
  e.g. `texture`->`baseMap`), `label`, `trajectoryPlot`, `mass`.
- Re-expand `instruments[].targets` into per-target sensor items; synthesize stable
  file/item names (documented lossy on names only).
- Carry any `besselExtra` passthrough bag back into the item verbatim.

Round-trip test (new `cosmographia-roundtrip.test.ts` in `packages/catalog`):
- A real multi-item fixture (`packages/catalog/test/fixtures/cosmographia-multi.json`)
  exercising at least one of each lossless trajectory/orientation/geometry type plus
  an instrument + observation.
- Assert `canonicalize(toCosmographia(fromCosmographia(fixture)))` deep-equals
  `canonicalize(fixture)` on the lossless subset (canonicalize = sort keys, drop
  synthesized filenames, normalize units/number formatting).
- A property test (fast-check style, if available, else table-driven): for generated
  catalogs over the lossless grammar, `fromCosmographia(toCosmographia(x))` is
  identity on `x` for every native catalog `x` in the subset.
- A negative test: a known-lossy construct emits a typed `CatalogWarning` rather
  than silently dropping, satisfying the loud-failure rule.

### 16.5 Section 2 status delta

When this lands, Section 2 row 1 ("JSON catalog parsing ... five catalog types")
flips **Partial -> Done**: the importer covers all item/trajectory/rotation/
geometry types and the lossless round-trip is asserted by
`cosmographia-roundtrip.test.ts`. The scorecard line `2. Catalog and data model`
moves from `3 Done / 1 Partial` to `4 Done / 0 Partial`. The remaining lossy
constructs are recorded as **By-design** (filename non-preservation) rather than a
gap, with the warning path as evidence.

---

## 17. Analysis-engine depth (beyond the Cosmographia viewer)

> Status: refreshed 2026-06-21. Section 8 tracks the Cosmographia *viewer*
> measurement readouts (angle, distance, altitude, geometric readouts). The
> numerical analysis engines below exceed Cosmographia entirely (it is a pure
> viewer with no equivalent), so they are tracked here as an appendix rather than
> inflating the Section 8 viewer tally. The binding requirements for this layer
> live in docs/STK_PARITY_SPEC.md Section 9; this subsection is the
> code-verified status of what landed this session, not a re-statement of those
> requirements. "Done" means implemented in the named module and exercised by a
> co-located test.

| Engine | Capability | Status | Evidence |
| --- | --- | --- | --- |
| `@bessel/access` | Line-of-sight + range; multi-hop relay chains; facility elevation | Done | `index.ts` (`computeAccess`, `computeChainAccess`), `facility.ts`; `access.test.ts`, `facility.test.ts` |
| `@bessel/access` | Range-rate constraint | Done | `range-rate.ts` (`computeRangeRateWindow`); `range-rate.test.ts` |
| `@bessel/access` | Sun-exclusion constraint via `gfsep` | Done | `sun-exclusion.ts` (`computeSunExclusionWindow`); `sun-exclusion.test.ts` |
| `@bessel/access` | Azimuth/elevation mask via `gfposc` | Done | `az-el-mask.ts` (`computeAzElMaskWindow`, `interpolateMaskFloor`); `az-el-mask.test.ts` |
| `@bessel/access` | Terrain-masked line of sight (via `@bessel/terrain`) | Done | `terrain-los.ts` (`computeTerrainMaskedLosWindow`); `terrain-los.test.ts` |
| `@bessel/events` | Umbra / penumbra / annular / sunlit intervals | Done | `index.ts` (`eclipseIntervals`); `eclipse.test.ts` |
| `@bessel/events` | Solar beta angle | Done | `beta.ts` (`betaAngle`, `betaAngleSeries`); `beta.test.ts` |
| `@bessel/events` | Solar intensity / penumbra fraction (two-circle lens overlap) | Done | `intensity.ts` (`solarIntensity`, `overlapArea`, `visibleFraction`); `intensity.test.ts` |
| `@bessel/rf` | Friis / gain / EIRP / G-T / link budget / Doppler / ITU-R rain (P.618/P.838) and gaseous | Done | `rf.test.ts`, `atmosphere.ts` |
| `@bessel/rf` | Off-axis antenna pattern + pointing loss + polarization loss | Done | `antenna-pattern.ts`; `antenna-pattern.test.ts` |
| `@bessel/rf` | Rain sky-noise temperature | Done | `atmosphere.ts`; `atmosphere.test.ts` |
| `@bessel/rf` | M-PSK / M-QAM BER + modcod table + link margin | Done | `modulation.ts` (`berMpsk`, `berMqam`, `MODCOD_TABLE`, `linkMarginDb`); `modulation.test.ts` |
| `@bessel/coverage` | Figure of merit / grid sweep / N-fold / Walker | Done | `index.ts` (`figureOfMerit`, `walkerConstellation`), `grid-sweep.ts`; `coverage.test.ts`, `grid-sweep.test.ts`, `grid-sweep-nfold.test.ts` |
| `@bessel/coverage` | Revisit / response-time + access-duration stats | Done | `fom-stats.ts` (`figureOfMeritStats`); referenced by `coverage.test.ts` |
| `@bessel/coverage` | Area-weighted figure of merit | Done | `grid-sweep.ts` (`areaWeightedPercentCoverage`); `area-weighted.test.ts` |
| `@bessel/conjunction` | Closest approach + 2D Foster Pc + all-vs-all screening | Done | `index.ts` (`closestApproachLinear`, `collisionProbability2D`), `screen.ts`; `conjunction.test.ts`, `screen.test.ts` |
| `@bessel/conjunction` | Full 2x2-covariance Pc (Mahalanobis) + B-plane projection | Done | `covariance.ts` (`collisionProbabilityCov`, `projectCovarianceToEncounterPlane`); `covariance.test.ts` |
| `@bessel/conjunction` | Alfano maximum Pc | Done | `max-pc.ts` (`maxCollisionProbability`); `covariance.test.ts` |
| `@bessel/conjunction` | Epoch-covariance STM propagation to TCA (via `@bessel/propagator`) | Done | `cov-propagation.ts` (`propagateCovarianceToTca`, `collisionProbabilityPropagated`); `cov-propagation.test.ts` |

UI surfacing of the above (the analysis-UX re-slot, complete 2026-06-22): every
engine capability in this table is now surfaced as a parameter or toggle on an
intent-named TaskCard in the consolidated analysis workbench, not engine-only. The
former flat `AnalysisPanel` is replaced by `apps/web/src/panels/AnalyzeWorkbench.tsx`
and the six domain panels (`OrbitManeuverPanel`, `LightingGeometryPanel`,
`AccessCommsPanel`, `ConjunctionPanel`, `CoveragePanel`, `ReportComparePanel`). The
deep capabilities (full-covariance Pc, B-plane, beta angle, az/el mask, sun keepout,
terrain LOS, range rate, area-weighted FOM, modcod margin, covariance input) are all
reachable from the UI. See docs/analysis-workbench.md and docs/analysis-personas.md
for the user-facing map; the analysis-UX goal is docs/analysis-ux-goal.md (COMPLETE).

Rendering and worker integration of the above:
- The coverage-grid result renders as a camera-relative contour overlay on the
  focus body (Section 5 row "Coverage-grid contour overlay"), colored by a selectable
  FOM metric with a legend, and the sweep runs on a dedicated, cancellable coverage
  worker (`apps/web/src/coverage.worker.ts`).
- All-vs-all conjunction screening runs off the main thread in a dedicated (single)
  Web Worker with progress and cancel: `apps/web/src/screening.worker.ts`,
  `apps/web/src/screening-client.ts`. It screens a REAL ingested catalog (pasted CCSDS
  CDM / OEM / TLE parsed via `@bessel/interop` and `@bessel/propagator`).
- The Lambert porkchop departure-vs-time-of-flight sweep runs on its own cancellable
  worker (`apps/web/src/porkchop.worker.ts`).
- Per-card inputs, engines, and validation provenance are catalogued in
  docs/analysis-tools.md; the per-tool input forms live in
  `apps/web/src/panels/analysis-tool-forms.tsx`.

---

## Sources

- SPICE-Enhanced Cosmographia User's Guide, cosmoguide.org: Geometry Types
  (https://cosmoguide.org/geometry-types/), Scripting
  (https://cosmoguide.org/scripting/), Showing Angles
  (https://cosmoguide.org/showing-angles/), Showing Geometric Parameters
  (https://cosmoguide.org/showing-geometric-parameters/), Observation Catalog
  (https://cosmoguide.org/catalog-file-defining-an-observation/), Spacecraft
  Catalog (https://cosmoguide.org/catalog-file-defining-a-spacecraft/).
- Cosmographia source and README: https://github.com/claurel/cosmographia
  (high-resolution texture auto-download, shadows and reflections, realistic
  stars and atmospheres, runtime catalog load, two-line element auto-update).
- ESA SPICE Cosmographia page: https://www.cosmos.esa.int/web/spice/cosmographia
  (mission plugin precedent).
- NAIF Cosmographia tutorial:
  https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/Tutorials/pdf/individual_docs/47_cosmographia.pdf
