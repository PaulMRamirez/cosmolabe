# M-0001: Spine ratification

Status: Accepted (provisional, review-on-return); evidence tables attached 2026-07-10 (Session 2), decision by the pre-stated rule below
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the spine acceptance itself, with the W1 bake-off evidence attached

## Context
Both codebases carry a scene and object model. The merge needs one spine: the object model and render architecture everything else consumes. Aaron's comparison argues for cosmolabe's core (zero-render, framework-agnostic, Aerie panel commitment); the merge review (docs/design/01, section 3.2) requires ratification by measurement, not assertion.

## Decision
Run the bake-off protocol of docs/design/02 section 3: four golden scenarios, three device classes, five measurements (screen-space jitter at 9.5 AU, state and orientation error versus SPICE truth, p95 frame time, memory high-water, purity audit). Decision rule stated in advance: cosmolabe's core wins unless it loses jitter or purity, the two properties a spine cannot retrofit cheaply. Regardless of outcome, time and frame semantics belong to the frames tier (M-0002), never to the scene.

## Consequences
The losing core's superior pieces migrate as separate, baseline-diffed PRs.

## Evidence addendum (Session 2, 2026-07-10)

Measured under the pinned capture environment recorded in `tests/golden/pre-merge/ENVIRONMENT.md`; machine-readable tables at `docs/validation/data/jitter.json` and `docs/validation/data/state-error.json`, reproduced by `scripts/jitter-scaffold.mjs` and `scripts/state-error.mjs`. Scope, stated honestly: the GS-1 through GS-4 fixtures do not exist yet as code; the measured scenes are the saturn-soi harness scene (Cassini at Saturn, the GS-2 reference case and the 9.5 AU float32 stressor, measured heliocentric distance 9.04 AU) and the SPICE-free analytical scene, with a no-rebase heliocentric configuration standing in for the GS-1 float32 stress. GS-3 and GS-4 land with the Session 3 differential harness. Device classes enter as tier pixel scales (viewport times the profile ladder DPR cap), not physical hardware; frame time and memory are device-pass measurements by nature and are carried, not faked.

Measurement 1, screen-space jitter (decision-critical). Float32 render-origin jitter against a float64 reference, camera 1000 km from the tracked target, envelope 0.5 device px:

| Configuration | Tier A | Tier B | Tier C | Verdict |
| --- | --- | --- | --- | --- |
| Cassini at 9.04 AU, origin tracked | 5.0e-5 px | 4.2e-5 px | 3.2e-5 px | inside envelope |
| Cassini at 9.04 AU, origin Saturn | 0.012 px | 0.010 px | 0.007 px | inside envelope |
| Enceladus, origin Saturn | 0.027 px | 0.023 px | 0.017 px | inside envelope |
| Moon at 1 AU, origin Earth | 0.048 px | 0.041 px | 0.031 px | inside envelope |
| Cassini, no rebase (counterfactual) | 166 px | 141 px | 107 px | the failure origin management prevents |

Both spine candidates carry the same defense: cosmolabe rebases the scene on an origin body and bakes origin-relative offsets into vertices in float64 km (`UniverseRenderer.updateFrame`), and bessel's scene declares camera-relative rendering a mandatory invariant (`bessel/packages/scene/src/camera-controller.ts`, `geometry-builders.ts`). Jitter therefore does not differentiate the candidates; the scaffold quantifies the shared architecture inside the envelope and the counterfactual two to three orders outside it.

Measurement 2, state and orientation error versus SPICE truth. Cosmolabe core through its own pipeline on saturn-soi, per-leg relative positions versus spkpos with correction NONE, maximum over the -12h to +12h sweep: at most 0.18 m (Titan), Saturn pole 0.92 arcsec versus the pxform IAU pole. Every oracle body sits inside the M-0002 pipeline tripwires (1 m, 5 arcsec) before the re-point begins. Bessel's layer carries its own SPICE conformance suite in the gate; the cross-core differential number is exactly what the Session 3 harness produces and is not claimed here.

Measurements 3 and 4, p95 frame time and memory high-water: not measurable headlessly and not measured; deferred to the W4 device-truth pass (M-0007 addendum) with this line as the carryover record.

Measurement 5, purity audit (decision-critical, lint-enforced by `scripts/purity-lint.mjs` in the root gate). Cosmolabe `packages/core`: zero violations. Bessel model layer (engines, state, catalog, interop, sdk, pal, spice, and the rest of the audited 23 directories): zero violations. Bessel's spine candidate `packages/scene`, audited via `--spine-audit`: five DOM couplings (an HTMLElement label layer, `document.createElement`, an HTMLCanvasElement render surface). Cosmolabe's core is zero-render in fact, not intent; bessel's scene is not.

Decision by the pre-stated rule: cosmolabe's core loses neither jitter nor purity, so cosmolabe's core is the spine. Per the Decision section, time and frame semantics still move to the `frames` tier (M-0002) regardless; bessel scene's superior pieces (none identified by these measurements) would migrate as baseline-diffed PRs.
