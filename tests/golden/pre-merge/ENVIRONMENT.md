# Pre-repoint baseline capture environment (Session 2, day zero)

This directory is immutable history (CLAUDE.md rule 5): the golden baselines of the cosmolabe subtree exactly as it stood before any SPICE re-point touched the renderer, captured 2026-07-10 on branch session-2 with zero modifications to cosmolabe-heritage source. Nothing in this directory is ever edited in place. The Session 3 re-point is expected to shift these goldens; when it does, the new numbers land as a deliberate, reviewed re-baseline in a new directory beside this one, with the diff against these files attached to the review. A silent shift is a gate failure, never a re-baseline.

## Contents and reproducibility classes

`fingerprints/` holds the deterministic numeric scene fingerprints (per-body EclipticJ2000 positions in km, composed body to world quaternions, frame wiring, and five trajectory samples per moving body) for the two heritage regression scenes, `saturn-soi` and `analytical-no-spice`, produced by the unmodified heritage harness at `cosmolabe/packages/core/src/__tests__/_harness/` through the root rig (`tests/rig/capture-fingerprints.rig.ts`). These reproduce byte-for-byte under the environment below, and as captured they are byte-identical to the heritage committed goldens at `cosmolabe/packages/core/src/__tests__/__goldens__/`.

`renders/` holds PNG frames of the built viewer (scenes `cassini-soi` at viewpoints "SOI (2004-07-01)" and "Ring Plane View", and `earth-moon` at its default viewpoint) captured in headless Chromium with SwiftShader software WebGL through the viewer's `?test=1` hook, the same mechanism, viewport, and thresholds as the heritage Layer 4 script (`cosmolabe/scripts/visual-regression.mjs`). Render reproduction is gated by pixelmatch (per-pixel threshold 0.1, failure above 0.5 percent differing pixels), not by bytes: on the capture machine, `earth-moon.png` recaptures byte-identically and the two `cassini-soi` frames recapture at 0.000 percent pixel difference with a handful of sub-threshold antialiasing bytes varying run to run.

`environment.json` is the machine-written record of the capture run; `SHA256SUMS` covers every baseline file and is verified by every compare.

## The pinned environment

TZ=America/Los_Angeles, mandatory, asserted by the tool: naked epoch strings in the cosmolabe path parse as machine local time (the named finding in `docs/collab/RE-ENTRY-BRIEF.md`), so the `analytical-no-spice` epoch, and with it every captured number, is timezone-dependent until the Class B fix lands. Node v22.23.1 with its bundled npm 10.9.8 (the `.nvmrc` pin is the 22 major; record and match the exact version for byte-for-byte work). pnpm 9.15.0 (the `packageManager` pin at root and in bessel). macOS 15.6 on darwin-arm64. Playwright 1.60.0 driving Chromium 148.0.7778.96 with `--use-gl=swiftshader`, viewport 1024x768 at deviceScaleFactor 1, 6000 ms settle before capture. Kernels restored by `scripts/fetch-kernels --all` (the demo scope includes the eight Cassini text kernels added to the manifest in Session 2; the viewer build bakes `test-catalogs/` into `dist/`, so fetch before building).

## Reproducing

    TZ=America/Los_Angeles node scripts/baseline.mjs compare

recaptures both families to a temporary directory, byte-compares the fingerprints, pixelmatch-compares the renders, and verifies `SHA256SUMS`. Run it under the pinned environment above; `scripts/baseline.mjs capture` is the deliberate re-baseline path and must never target this directory again.

## Known divergence from the heritage visual goldens

The heritage committed render goldens at `cosmolabe/apps/viewer/test-screenshots/__goldens__/` do not reproduce from the repository as it stands: the two `cassini-soi` frames there were captured with the full multiyear Cassini SCPSE kernel set present in the author's working tree (the golden shows Cassini's whole-mission trajectory fan), while the committed catalog kernels cover only the SOI week, and differ by roughly 2.4 to 3.0 percent of pixels. `earth-moon` reproduces at 0.013 percent.

To be explicit about the relationship: the `cassini-soi` baselines in this directory are rendered from the fetchable kernel set (`scripts/fetch-kernels --all`) and therefore deliberately differ from Aaron's committed heritage goldens, which presuppose his full multiyear kernel set. The two artifacts answer different questions. These baselines are the reproducible truth, capturable by anyone from exactly what the repository provides, and they are what Session 3 must preserve; the heritage goldens are a recorded finding about an environment the repository does not carry. Neither is a regression of the other, and no compare should ever be run between them as if one gated the other. The heritage goldens are untouched, and the finding is recorded for Aaron in the re-entry brief.
