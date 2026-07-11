# @bessel/scene

Builds and updates the Three.js scene graph for a mission from inert
`SceneSpec` data, using camera-relative (floating-origin) rendering so
solar-system-scale coordinates never reach float32 GPU buffers. It is part of
the core layer: it takes plain data computed elsewhere (catalog plus SPICE
state) and turns it into renderable geometry, with no SPICE calls of its own.

## Public API

- Scene: `SolarSystemScene` (the imperative WebGL scene), `buildScene` plus the
  `SceneTarget` interface (applies a `SceneSpec` through structural setters, so
  the build step is headless-testable against a mock).
- Spec types: `SceneSpec` and its parts (`SpacecraftSpec`, `TrajectorySpec`,
  `OrbitSpec`, `RingSpec`, `AxisTriadSpec`, `AtmosphereSpec`,
  `DirectionVectorsSpec`, `CameraSpec`, `LabelSpec`, `ParticleSystemSpec`,
  `KeplerianSwarmSpec`, `TimeSwitchedSpec`, `Rotation3x3`, `Rgb01`).
- Geometry builders (pure, scaled): `cameraRelativeOffset`, `coneTriangleVertices`,
  `fanTriangleVertices`, `dskTriangleVertices`, `centroidOf`, plus `SCALE` and
  `KM_PER_UNIT`. Mesh builders: `buildDskMesh`, `buildRingMesh`, `buildAtmosphere`,
  `buildStarField`, `buildAxisTriad`, `buildArrow`/`buildDirectionVectors`,
  `buildParticleSystem`, `buildKeplerianSwarm`.
- Catalog data and helpers: `SOLAR_SYSTEM`/`PlanetDef`, `parseStarCatalog`/`radec2vec`,
  `orbitEllipse`/`orbitPeriod` (osculating ellipse from a state vector).
- Orientation and camera: `rowMajor3x3ToMatrix4`, `applyAttitude`,
  `applyQuaternion`, `computeTrackCameraPosition`, `computeOrbitCameraPosition`,
  `azimuthElevationFromDirection`, `CameraMode`.
- Interaction and chrome: `pickObjectId`/`pointerToNdc`, `LabelLayer`/`projectToScreen`,
  `loadSpacecraftModel`, `computeShadowFrustum`/`buildSunLight`, `activeSegment`.

```ts
import { SolarSystemScene, buildScene, type SceneSpec } from '@bessel/scene';

const scene = new SolarSystemScene(canvas);
buildScene(scene, spec); // spec: SceneSpec computed from catalog + SPICE state
```

## Dependency rule

Depends on: `@bessel/pal`, `@bessel/spice`, `@bessel/catalog`, `@bessel/timeline`,
`@bessel/color` (plus `three`). Part of the core layer: it imports only other core
packages and the PAL interface, never a concrete PAL implementation, the UI, or
a shell.

## Tests

Tests live in `packages/scene/src/*.test.ts` (Vitest, run headless in Node, where
a real `WebGLRenderer` cannot be constructed). They cover the pure math and
build logic: `geometry-builders.test.ts` asserts the camera-relative offset and
triangle layouts, `orbit.test.ts` checks the osculating ellipse and period,
`scene-builder.test.ts` records setter calls against a `SceneTarget` mock, with
further suites for camera modes, picking, labels, orientation, star field,
particle and Keplerian swarm positions, and time-switched segments.

## Status / limitations

WebGL-first and headless-friendly: the scene object needs a real canvas, so it
is exercised end to end through Playwright rather than in unit tests. Orbit paths
are osculating (single-epoch) ellipses, not full propagated ephemeris.
