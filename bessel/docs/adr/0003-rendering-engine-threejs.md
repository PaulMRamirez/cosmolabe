# ADR-0003: Three.js as the rendering engine

Status: Accepted (carried forward from prior Bessel design)
Date: 2026-06-07

## Context

Bessel needs a WebGL rendering foundation that handles solar-system-scale
scenes, has a mature shader ecosystem (atmosphere, rings, star fields), and is
license-compatible with Apache-2.0. The two realistic candidates were Three.js
and Babylon.js.

## Decision

Use Three.js, on WebGL2 first. Design @bessel/scene behind an abstraction that
allows a later migration to a WebGPU renderer without rewriting the scene-graph
builder.

Camera-relative rendering is mandatory: positions are computed relative to the
camera before being sent to the GPU, to avoid float32 jitter at large distances.

## Consequences

- Lighter bundle and a larger community shader ecosystem than the alternative;
  good fit with the existing body of Three.js solar-system prior art.
- WebGPU is deferred. The renderer abstraction is the migration insurance.
- The operations-specific scene elements (FOV cones, footprints, frame axes,
  direction vectors) are not off the shelf and must be built in @bessel/scene.

## Alternatives considered

- Babylon.js: a batteries-included engine with a stronger built-in WebGPU story
  and inspector. Rejected for a heavier bundle and weaker fit with the existing
  Three.js prior art, though it remains a credible fallback if WebGPU needs
  accelerate.
