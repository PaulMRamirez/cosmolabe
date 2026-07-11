# CLAUDE.md

Canonical agent context for Bessel. This is the file Claude Code reads at the
start of every session. The authoritative requirements live in SPEC.md; this
file is the in-session operating manual.

---

## Project

Bessel is an open-source, SPICE-aware 3D mission visualization application
delivered from a single codebase as a Progressive Web App, as native mobile apps
via Capacitor, and as a desktop app via Electron. It reads Cosmographia-compatible
catalogs, drives geometry from CSPICE compiled to WebAssembly, and renders with
Three.js. License: Apache-2.0.

Read first: SPEC.md for the requirements and the verifiable command catalog,
then docs/PARITY_MATRIX.md for the current implemented status. ADRs in docs/adr/
record the binding decisions.

---

## Tech stack

- Language: TypeScript (strict). Runtime: Node.js 22 LTS. Package manager: pnpm 9+
  (workspace monorepo).
- Rendering: Three.js (WebGL2 first). SPICE: CSPICE-WASM in a Web Worker
  (forked from arturania/cspice).
- UI: React. Build: Vite. PWA: vite-plugin-pwa. Desktop: electron-vite. Mobile:
  Capacitor. Tests: Vitest (unit and contract), Playwright (e2e, including
  Electron).

---

## Verifiable command catalog

These root scripts are the vocabulary the /goal completion checker runs. They
must exist and exit 0 on success.

| Script               | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`     | tsc --noEmit across all packages and apps                   |
| `pnpm lint`          | ESLint across the workspace, zero warnings                  |
| `pnpm test`          | Vitest unit and contract tests, all passing                 |
| `pnpm build:web`     | Vite production build of apps/web                           |
| `pnpm build:desktop` | electron-vite build of apps/desktop                         |
| `pnpm build:cli`     | bundle apps/cli to a runnable Node binary (the bessel batch runner) |
| `pnpm cap:sync`      | cap sync ios against apps/web/dist (Android deferred)       |
| `pnpm e2e`           | Playwright end-to-end suite, headless, including the a11y scan |
| `pnpm size`          | size-limit per-chunk budgets (.size-limit.json): first-paint shell, lazy analysis, worker, WASM |
| `pnpm audit:prod`    | pnpm audit, production deps, fails on high or critical      |
| `pnpm lhci`          | Lighthouse CI assertions on the built PWA (Phase 2 on)      |
| `pnpm bench`         | Vitest bench micro-benchmarks (informational)               |
| `pnpm release:dry`   | changesets version and publish dry-run                      |
| `pnpm cspice:build`  | relink CSPICE to WASM (Emscripten); only when changing exports |
| `pnpm verify`        | typecheck, lint, test, build:web, size in sequence; the gate|

The size budget is split per chunk, not one summed number: the first-paint shell
(the eager `app-*.js` + `vendor-*.js`, the JS the browser must download before the
scene renders) is budgeted separately from the lazy analysis bundle (the workbench
panels and analysis engines, fetched on first use via dynamic import), the SPICE
worker, and the lazy CSPICE WASM. So the lever for shell headroom is to keep new
heavy, not-first-paint code behind a dynamic-import boundary (a React.lazy panel and
an `await import()` in the engine), which moves it into the lazy bundle, not to grow
the shell. Three.js and React are the irreducible first-paint floor and stay in
`vendor`. Never edit .size-limit.json or lighthouserc.json to make a budget pass;
loosen a limit only as a deliberate, raised decision, never silently, and prefer
splitting code over raising the shell limit. CI runs this same vocabulary
(.github/workflows/ci.yml), so do not introduce commands that pass locally but
cannot run in CI.

A PWA build is valid only when apps/web/dist contains both manifest.webmanifest
and a generated service worker. "Renders" is asserted by a Playwright test that
loads a fixture and checks for a non-empty WebGL frame, never by judgement.

---

## /goal session rules (always follow)

- Never delete, skip, comment out, or weaken a test to satisfy a completion
  condition. Test count must not drop below the phase baseline.
- Never weaken type checking. No blanket any and no ts-ignore to pass typecheck,
  except with an inline comment justifying a genuine external-types gap.
- Never disable lint rules to pass; fix the root cause.
- Never modify docs/adr/, this file, or SPEC.md during a feature goal. Decisions
  change deliberately, not as a side effect.
- Never commit secrets or kernels-as-data. See .claudeignore.
- If ambiguous, add a // TODO: <question> comment and continue; raise a checkpoint
  only for decisions not covered by the active goal file.

---

## Architecture conventions (binding)

- Dependency rule: lower layers never import higher ones, and the core never
  imports a concrete PAL implementation. Order is plugins, core, PAL interface,
  UI, shells. Core (@bessel/spice, catalog, scene, timeline, state, color, the
  analysis-engine packages: propagator, access, events, rf, coverage, conjunction,
  attitude, sensors, mission, map-projection, interop, analysis, terrain, od, and
  the headless automation package sdk) depends only on other core packages and the
  @bessel/pal interface. The UI depends on core and the PAL interface. Shells inject
  one PAL implementation at startup (pal-web, pal-electron, pal-capacitor for the
  GUI shells; pal-node for the headless CLI). The workspace has 27 packages in all
  (see docs/architecture.md for the map). If a task tempts you to break this rule,
  the scope is wrong; stop and flag it.
- The SPICE engine never reads kernel bytes directly. Kernels arrive through the
  PAL KernelSource so the same engine works over HTTP range, Capacitor paths, and
  the Electron filesystem.
- Camera-relative rendering is mandatory. Compute positions relative to the camera
  before handing them to the GPU; never feed raw solar-system-scale coordinates to
  float32 GPU buffers.
- Fail loudly. Missing kernels, unresolved bodies, and bad catalog references
  produce explicit, located, typed errors. Never silently re-center the camera
  (the Cosmographia "jump to the Sun" behavior is a defect, not a default).
- No browser storage shortcuts that break the PWA: use OPFS and the PAL Storage
  interface, not ad hoc globals.

---

## Writing conventions

- Do not use em dashes anywhere, in code comments, docs, commit messages, or UI
  copy. Use commas, colons, parentheses, or semicolons instead. This is a hard
  rule for this repository.
- Commit messages: conventional commits (feat, fix, chore, docs, test, refactor),
  scoped by package or phase, for example feat(scene): add FOV cone mesh.

---

## File-size and structure guidelines

- Prefer small, single-responsibility modules. Soft caps: components 200 lines,
  core modules 250 lines, utilities 120 lines. Split when exceeded rather than
  suppressing.
- Each core package exposes a typed public API from its index; internals stay
  internal.

---

## Testing standards

- Unit tests for all core logic; the @bessel/spice fixture test asserts a
  spkpos value against a NAIF reference within tolerance.
- Contract tests for the PAL: every implementation passes the same KernelSource,
  FileSystem, Storage, and Share contract suites against its fixtures.
- e2e tests assert rendering and behavior on fixture catalogs across targets.
- Coverage target: meaningful coverage of core packages; do not chase a number by
  testing trivia.

---

## Post-goal review (for the human, restated here for the agent's awareness)

After a goal clears, the human runs: git diff --name-only, git diff, a grep for
new ts-ignore or eslint-disable or skipped tests, and pnpm verify, before
committing. Write your changes assuming this review will happen.
