# Visual regression (Layer 4)

Headless screenshot regression for the viewer. Catches **render-only** bugs the
numeric test layers (in `packages/core/src/__tests__/`) can't see — ring-plane
tilt, triaxial-ellipsoid (oblateness) scaling, texture/material orientation.

The numeric layers (SPICE oracle, golden fingerprints, invariants) are the
primary regression net and run in plain `vitest`. This visual layer is the
belt-and-suspenders for the GPU pipeline and runs separately because it needs a
browser + a built viewer + the scene's SPICE kernels.

## How it works

`scripts/visual-regression.mjs` drives the built viewer in headless Chromium
(software WebGL via SwiftShader, for cross-machine determinism). It loads each
scene with `?catalog=<name>&test=1`. The `?test=1` flag (see
`apps/viewer/src/lib/loader.ts`) strips GPU-variant noise — antialias, bloom,
starfield — and installs `window.__cosmolabe`, whose `capture(viewpoint)` renders
one synchronous frame and returns a PNG. Frames are pixel-diffed (`pixelmatch`)
against the goldens in `__goldens__/`; a scene fails if more than `VR_MAX_DIFF`
(default 0.5%) of pixels differ.

## One-time setup

```sh
npm --prefix apps/viewer i           # picks up playwright / pixelmatch / pngjs devDeps
npx playwright install chromium
npm --prefix apps/viewer run build   # vite preview serves this build
```

The scenes (`cassini-soi`, `earth-moon`) fetch their SPICE kernels at load time
(some large + LFS-backed) — ensure `git lfs pull` has run.

## Generate / update goldens

```sh
npm --prefix apps/viewer run test:visual:update
```

Review the resulting `__goldens__/*.png` before committing.

## Run the check

```sh
npm --prefix apps/viewer run test:visual
```

On failure it writes `<scene>-actual.png` and `<scene>-diff.png` next to this
README for inspection. Against an already-running server, set
`CL_VIEWER_URL=http://localhost:5173`.

## Tunables (env)

| var | default | meaning |
|-----|---------|---------|
| `VR_THRESHOLD` | `0.1` | pixelmatch per-pixel color threshold |
| `VR_MAX_DIFF` | `0.005` | max fraction of differing pixels before failing |
| `VR_SETTLE_MS` | `6000` | wait after scene-ready for async textures/tiles to stream |
| `CL_VIEWER_URL` | — | use a running server instead of spawning `vite preview` |

Goldens are committed PNGs; `-actual`/`-diff` artifacts are not (see
`.gitignore`).
