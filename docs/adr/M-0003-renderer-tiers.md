# M-0003: Renderer tiers on the WebGPU path

Status: Accepted (provisional, review-on-return) on the jitter envelope evidence attached 2026-07-10 (Session 2); frame time and memory complete in the W4 device pass
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the tier acceptance with W1 evidence, and any enforcement action taken against the Cesium backend

## Context
Dual Three plus Cesium as peers doubles the render maintenance surface forever. The 3DTilesRendererJS ecosystem is absorbing terrain, overlay, and globe jobs; WebGPU is Baseline (default in iOS 26, iPadOS 26, macOS Tahoe 26) and Three r171+ ships WebGPURenderer with automatic WebGL 2 fallback. See docs/design/01 section 3.3 and docs/design/02 section 4.

## Decision
The renderer is a capability boundary behind an interface. Tier 1 is Three.js targeting WebGPURenderer with automatic WebGL 2 fallback. The Cesium backend is optional and passes a per-release earn-its-keep gate: a nonempty unique-capability list, a measured bundle delta, a passing embed smoke test; failing twice consecutively triggers a deprecation ADR (that ADR is Class C, parked for Aaron). No CesiumJS-to-ion coupling. CZML export covers Cesium interop without carrying the renderer.

## Consequences
WKWebView WebGPU availability is verified on device in W4 before the Companion render path relies on it (addendum to M-0007).

## Evidence addendum (Session 2, 2026-07-10)

The tier envelopes are hereby defined and measured. A renderer tier accepts a device class only if float32 render-origin jitter stays at or below 0.5 device pixels (invisible sub-pixel motion) with the camera 1000 km from a tracked target at solar-system distances, measured by the scaffold at `tests/rig/jitter.rig.ts` (machine-readable table: `docs/validation/data/jitter.json`, reproduced by `TZ=America/Los_Angeles node scripts/jitter-scaffold.mjs`). Device tiers enter as pixel scales from the bake-off protocol and the M-0007 profile ladder: tier A 1512x982 at DPR 2.0, tier B 1194x834 at DPR 2.0, tier C 390x844 at DPR 1.5.

Measured on the tier 1 (Three.js) floating-origin path: with the origin on the tracked body, at most 5.0e-5 px on any tier (Cassini at 9.04 AU, Enceladus, and the analytical Moon all agree); with the origin on the target's primary, the worst case the architecture permits, at most 0.048 px (analytical Moon, tier A). Every gated configuration sits one to four orders of magnitude inside the envelope. The no-rebase counterfactual measures 107 to 187 px at 9 AU and 12 to 23 px at 1 AU: origin management is what makes the envelope holdable, which is why it is a spine property (M-0001) and a tier acceptance criterion here.

Not measured here, stated honestly: p95 frame time and memory high-water need physical devices and land in the W4 device-truth pass alongside the WKWebView WebGPU verification; the Cesium backend was not exercised this session, its earn-its-keep gate is unchanged, and no enforcement action is taken or recorded against it.
