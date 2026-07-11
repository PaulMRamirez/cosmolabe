# M-0007: Platform, profile, shell; the iOS target definition

Status: Accepted; device-truth addendum pending (W4)
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the W4 device-truth addendum

## Context
"Tri-target" conflated three axes, and the iPhone workbench would be too visually heavy for a phone. See docs/design/02 section 7.

## Decision
Three orthogonal axes. Platform: `pal` plus `pal-web`, `pal-electron`, `pal-capacitor`, `pal-node`, services only, nothing visual. Profile: a runtime capability probe resolves a RenderProfile (tier A ray-marched atmosphere, tier B LUT approximation, tier C limb-glow shell, with DPR caps, tile budgets, and invalidation-driven rendering mandatory at C) and a ComputeProfile (worker and WASM heap caps; tier C interactive jobs only). Shell: the iPhone ships the panel in native chrome (the Companion), not the workbench; the iPad ships the workbench. Compute baseline on the Companion is transferable-buffer, since Capacitor's scheme handler cannot reliably set COOP and COEP; threads are an opportunistic upgrade when the probe reports isolation.

## Consequences
W4 records WKWebView SharedArrayBuffer and WebGPU probe results, thermal behavior over a 20-minute scrub, and OPFS budget behavior as the addendum here.
