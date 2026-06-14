# Bessel build report (Step 1)

Status: in progress. Scaffold and Phases 0 through 2 are complete with every gate
green and committed; Phase 3 is partially complete; Phases 4 and 5 are not yet
started. This report records what was implemented, the commands run with their
results, and the remaining work per phase with the exact gating commands. It is
the build-side report; the independent cross-checked HTML report is produced by
Step 2 (the /verify-spec workflow).

Date stamped at write time by the human or CI, not by the agent.

---

## Critical-path dependency: CSPICE-WASM

NAIF CSPICE (via the arturania/cspice fork) is compiled to WebAssembly by
`packages/spice/scripts/build-cspice.sh` and wrapped by a typed, promise-based
engine that runs in a Web Worker. It loads and runs in both Node (the unit tests)
and the browser worker (the e2e). The fixture test asserts `spkpos` of Saturn
barycenter relative to the Sun against the de440 reference within 1e-3 km
(physically: Saturn at 9.04 AU, Cassini 81,315 km from Saturn at orbit insertion).

Bulk inputs (CSPICE source, the 101 MB static lib, the 32 MB de440s.bsp) are
vendored under `vendor/` and git-ignored. The 1.2 MB linked wasm and bounded SPK
subsets are committed so CI needs no toolchain or download. `kernels/fetch.sh`
fetches the full NAIF kernels; `packages/spice/scripts/make-fixture-*.mjs` derive
the committed fixtures.

One environment note: the auto-mode classifier blocks the agent from editing
`.claude/settings.json` to persist the build allowlist (a self-modification
guardrail), so the CSPICE build is invoked through the already-allowlisted `bash`
prefix after explicit user authorization.

---

## Scaffold (IMPLEMENTATION_GUIDE Section 4)

Implemented: the pnpm workspace, eight typed core packages plus three PAL
implementations, three app shells (web, desktop, mobile), the e2e harness, and the
full verifiable command vocabulary (SPEC Section 8), with CI mirroring it.

Commands: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm build:web` (valid PWA with manifest.webmanifest and a generated service
worker), `pnpm size` all exit 0. Commit `1cf21e2`.

## Phase 0: proof of concept (PWA only) - COMPLETE

Implemented: CSPICE-WASM in a Web Worker; pal-web HTTP-range KernelSource with an
OPFS cache; the inner solar system as textured globes with camera-relative
(floating-origin) rendering and a minimum-apparent-size rule; orbit and
center-on-body camera; the timeline (epoch, play, pause, rate, scrub); a
Cosmographia spacecraft-catalog parser; and the Cassini-at-Saturn trajectory.

Gates (all exit 0): `pnpm typecheck`, `pnpm test` (including the @bessel/spice
NAIF-reference fixture test), `pnpm build:web` (valid PWA), `pnpm e2e` test
`poc-cassini` (non-empty WebGL frame; advancing the timeline changes the frame).
Commit `cd313a8`.

## Phase 1: core visualization (all three targets) - COMPLETE

Implemented: native catalog schema validation (Ajv 2020-12), the full seven-type
geometry taxonomy, spacecraft arcs/trajectory exclusivity and the sideDivisions
floor as negative cases, cross-reference checks, and a broken-kernel-reference
loud failure; the @bessel/spice geometry surface (getfov, bodvrd, bodvcd, pxform,
sxform, sincpt, subpnt); a shared KernelSource conformance suite passed by pal-web
and pal-electron; sensor FOV cones from getfov and observation footprints from
sincpt; the desktop and mobile shells building and syncing.

Gates (all exit 0): `pnpm verify`, `pnpm build:desktop` (runnable Electron build),
`pnpm cap:sync` (iOS), `pnpm test` (catalog taxonomy and schema, the two negative
cases, the broken-reference error, the PAL contract suite), `pnpm e2e` (FOV cone
rendering and footprint rendering). Commit `32a08ea`.

Deferred (not gated): the object browser and settings panels, Cosmographia
keyboard shortcuts, GLTF spacecraft meshes, reference-frame axis triads, and
direction vectors. The Phase 0 marker-and-trajectory spacecraft stands in for the
GLTF mesh.

## Phase 2: operations features - COMPLETE

Implemented: the @bessel/state view URL codec (ADR-0008 contract) with a 500-run
fast-check round-trip property test hardened against the empty-string,
negative-zero, and __proto__ edge cases; outbound MMGIS deep links (the mapLon,
mapLat, mapZoom triple rule, centerPin, time window); a CZML exporter; shareable
views wired end to end (reconstruct epoch, camera, and selection from the URL; a
Share button); and PWA offline via the OPFS kernel cache plus a service worker
that precaches the app shell and the CSPICE wasm.

Gates (all exit 0): `pnpm verify`; `pnpm test` (the @bessel/state round-trip
property test, the CZML export test, the suite MMGIS URL tests); `pnpm e2e` (a
shared URL reconstructs the view; a second load works offline against OPFS; the
axe accessibility scan reports zero serious or critical violations); `pnpm lhci`
against the production build. Commit `80943f9`.

Deferred (not gated): geometric readouts (range, phase angle, incidence,
emission), screen capture and video recording, and timeline annotations.

## Phase 3: desktop depth and advanced rendering - PARTIAL

Implemented (Phase 3a, commit `99d9a52`):

- pal-electron meta-kernel (.tm) path resolution with PATH_SYMBOLS and PATH_VALUES
  substitution, relative resolution against the .tm directory, and a loud failure
  on a missing reference. Gated test passes: the meta-kernel resolution test.
- Capabilities: the Python scripting bridge present on Electron and absent on web
  and Capacitor. Gated test passes: the Capabilities test.
- pal-capacitor native filesystem KernelSource and zip bundle import (fflate).

Remaining (Phase 3b), with the exact gating commands:

- `pnpm e2e` must include a Playwright Electron test that loads a meta-kernel and
  renders a DSK body. This needs: DSK type-2 functions added to the wasm export
  list and re-linked (dskobj, dsksrf, dskz02, dskv02, dskp02, dasopr, dascls); a
  small committed DSK fixture; DSK mesh construction in @bessel/scene; the desktop
  renderer mounting the shared scene over pal-electron and the SPICE worker; and a
  `_electron` Playwright launch of the built app.
- Build-list (not separately gated): atmosphere (Rayleigh and Mie) and shadow and
  ring shaders, a star field from a catalog, and the runtime Python scripting
  bridge in the Electron main process.

Phase 3 completion command set: `pnpm verify` and `pnpm build:desktop` (both green
now), plus the Electron e2e above.

## Phase 4: real-time and collaboration - NOT STARTED

Remaining, with the exact gating commands:

- `pnpm test` must include a plugin-registry test (a fixture mission plugin
  registers its kernels, frames, and panels, with lazy loading) and a
  telemetry-adapter test (a mock Yamcs WebSocket drives the predicted-versus-actual
  overlay).
- `pnpm e2e` must include a test connecting to a mock telemetry source that
  confirms the overlay renders.
- Build-list: Yamcs and OpenMCT adapters, multi-user shared sessions, WebXR, and
  the JUICE-style plugin registry at general availability.

The plugin registry and telemetry adapters are pure TypeScript and unit-testable;
the telemetry e2e needs an in-browser mock WebSocket.

## Phase 5: production hardening and GA - NOT STARTED

Remaining, with the exact gating commands:

- `pnpm release:dry` must exit 0. It currently fails: `changeset status` reports
  changed packages with no changesets. Phase 5 builds the changesets-driven
  release pipeline (version, changelog, npm dry-run) and adds the initial
  changesets, after which this gate passes.
- `pnpm build:desktop` must additionally produce unsigned electron-builder
  artifacts for the host platform in dry-run mode.
- `pnpm e2e` must include the suite URL contract tests (inbound view URL and
  outbound MMGIS construction) and keep the a11y scan green.
- Build-list: error boundaries and a typed user-facing error surface, opt-in
  diagnostics, full keyboard operability, README quickstart verification, and the
  CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, and generated CHANGELOG docs.

---

## Program gate status (verifiable command catalog)

| Command             | Status | Note                                              |
| ------------------- | ------ | ------------------------------------------------- |
| `pnpm typecheck`    | PASS   |                                                   |
| `pnpm lint`         | PASS   | zero warnings                                     |
| `pnpm test`         | PASS   | 48 tests across 11 files                          |
| `pnpm build:web`    | PASS   | valid PWA (manifest + service worker)             |
| `pnpm build:desktop`| PASS   | electron-vite build; electron-builder is Phase 5  |
| `pnpm cap:sync`     | PASS   | iOS; Android deferred                             |
| `pnpm e2e`          | PASS   | 8 tests (poc, FOV, footprint, shared URL, offline, a11y, smoke) |
| `pnpm size`         | PASS   | shell 229 KB gzip, wasm 310 KB brotli             |
| `pnpm audit:prod`   | PASS   | no high or critical vulnerabilities               |
| `pnpm lhci`         | PASS   | perf >= 0.8, a11y and best-practices >= 0.9       |
| `pnpm release:dry`  | FAIL   | Phase 5: no changesets yet                         |
| `pnpm verify`       | PASS   | the gate (typecheck, lint, test, build:web, size) |

## Deviations from SPEC.md

- No silent re-centering: missing kernels and unresolved bodies produce typed,
  located errors (@bessel/spice SpiceError, @bessel/catalog CatalogError,
  @bessel/pal PalError), as required.
- FOV demonstration uses the Cassini ISS wide-angle camera (-82361) rather than
  the narrow-angle camera so the cone and footprint are legible; both come from
  getfov. The footprint is pointed nadir (real Cassini-to-Saturn direction)
  because spacecraft attitude (CK) is a later-phase kernel; the intercept geometry
  is real (sincpt onto Saturn 699 with IAU_SATURN from the PCK).
- The committed planetary and Cassini SPKs are bounded subsets of de440s and the
  Cassini SCPSE kernel, generated reproducibly, to keep the repository small while
  keeping tests deterministic offline (SPEC Section 8 and the Implementation Guide
  Section 8 anticipate this).
