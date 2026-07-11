# M-0003: Renderer tiers on the WebGPU path

Status: Proposed, pending W1 performance evidence; direction agreed
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the tier acceptance with W1 evidence, and any enforcement action taken against the Cesium backend

## Context
Dual Three plus Cesium as peers doubles the render maintenance surface forever. The 3DTilesRendererJS ecosystem is absorbing terrain, overlay, and globe jobs; WebGPU is Baseline (default in iOS 26, iPadOS 26, macOS Tahoe 26) and Three r171+ ships WebGPURenderer with automatic WebGL 2 fallback. See docs/design/01 section 3.3 and docs/design/02 section 4.

## Decision
The renderer is a capability boundary behind an interface. Tier 1 is Three.js targeting WebGPURenderer with automatic WebGL 2 fallback. The Cesium backend is optional and passes a per-release earn-its-keep gate: a nonempty unique-capability list, a measured bundle delta, a passing embed smoke test; failing twice consecutively triggers a deprecation ADR (that ADR is Class C, parked for Aaron). No CesiumJS-to-ion coupling. CZML export covers Cesium interop without carrying the renderer.

## Consequences
WKWebView WebGPU availability is verified on device in W4 before the Companion render path relies on it (addendum to M-0007).
