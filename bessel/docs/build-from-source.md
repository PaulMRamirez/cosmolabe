# Building from Source and Relinking CSPICE-WASM

Most contributors never touch the toolchain-heavy steps: the committed
`packages/spice/wasm` artifact and the bundled kernel fixtures mean `pnpm install`
is enough to build and test. This document covers the full path, including the one
step that needs a C/WASM toolchain (relinking CSPICE) and regenerating the SPICE
fixtures.

## Prerequisites

- Node.js 22 LTS and pnpm 9+ (a workspace monorepo; corepack can pin pnpm).
- For the apps: nothing beyond Node. For the desktop shell, the platform's
  Electron build prerequisites; for the iOS shell, Xcode and CocoaPods.
- For relinking CSPICE only: Emscripten (`emcc`, `emcmake`) on PATH.

## Bootstrap

```
pnpm install
```

This installs the workspace and links the packages. The committed
`packages/spice/wasm/cspice.mjs` and `cspice.wasm` are used as-is; you do not need
Emscripten unless you are changing the CSPICE export surface.

## The gates

The verifiable command catalog (the vocabulary CI and the `/goal` checker run) is
defined in CLAUDE.md; do not duplicate it. The single most useful command:

```
pnpm verify    # typecheck, lint, test, build:web, size, in sequence
pnpm e2e       # Playwright end-to-end, headless, including the a11y scan
```

CI runs the same vocabulary (`.github/workflows/ci.yml`), so a command that passes
locally passes in CI.

## Building the apps

```
pnpm --filter @bessel/web dev      # web app, Vite dev server
pnpm build:web                     # production PWA build (apps/web/dist)
pnpm build:desktop                 # Electron build via electron-vite
pnpm cap:sync                      # sync the iOS shell against apps/web/dist
```

A PWA build is valid only when `apps/web/dist` contains both
`manifest.webmanifest` and a generated service worker.

## Relinking CSPICE-WASM

The SPICE engine is CSPICE compiled to WebAssembly (forked from
arturania/cspice). You only need this when adding or removing a CSPICE function
from the engine's surface.

```
pnpm cspice:build    # bash packages/spice/scripts/build-cspice.sh
```

- Inputs: the vendored CSPICE source (under `vendor/`, which is gitignored and
  not committed; the script fetches/builds it) and the Emscripten `EXPORTS` list
  in the script (the `_*_c` functions the bindings call).
- Outputs: `packages/spice/wasm/cspice.mjs` and `packages/spice/wasm/cspice.wasm`,
  which are committed (the small linked artifacts, not the multi-megabyte source).
- Budget: the WASM must stay under 4 MB (it is ~359 kB brotli today). `pnpm size`
  re-measures it; never edit `.size-limit.json` to pass a budget.
- After a relink, run `pnpm verify` and `pnpm e2e`: the SPICE fixture tests assert
  binding behavior against NAIF references, so a bad export shows up immediately.

The 6-layer binding pattern for adding one CSPICE function: the `_*_c` export
(build script) -> the marshalling in `packages/spice/src/bindings.ts` -> the
worker request/result in `protocol.ts` -> the dispatch in `worker-core.ts` -> the
client call in `client.ts` and the pool delegation in `pool.ts` -> the method on
the `SpiceEngine` interface and the in-process engine in `engine.ts`.

## Regenerating the SPICE fixtures

The committed test fixtures under `kernels/fixtures/` are small, bounded SPK/PCK
files; the bulk kernels they derive from are gitignored. To regenerate them:

```
node packages/spice/scripts/make-fixture-spk.mjs
node packages/spice/scripts/make-fixture-cassini.mjs
```

The `@bessel/spice` fixture test asserts an `spkpos` value against a NAIF reference
within tolerance, so a bad fixture fails the unit suite.

## Troubleshooting

- Emscripten not found: ensure `emcc`/`emcmake` are on PATH (source the emsdk
  `emsdk_env` script). The relink is the only step that needs them.
- WASM size over budget after a relink: trim the `EXPORTS` list to only the
  functions the bindings actually call; `pnpm size` reports the brotli size.
- e2e failures after a SPICE change: run the spice unit tests first
  (`pnpm vitest run packages/spice`) to localize a binding regression before the
  browser layer.
- A mission fails to load with a located error: the kernels its bodies need are
  not furnished. Kernels arrive through the PAL `KernelSource`; the bundled demo
  kernels cover the inner system, Saturn, and Cassini only.
