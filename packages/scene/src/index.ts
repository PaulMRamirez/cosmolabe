// @bessel/scene: builds and updates the Three.js scene graph from catalog plus
// SPICE state, with camera-relative rendering (mandatory, CLAUDE.md). Phase 0
// renders textured planet globes and a spacecraft trajectory polyline.

export { SolarSystemScene, type Km3 } from './three-scene.ts';
export { INNER_SYSTEM, type PlanetDef } from './planets.ts';
export {
  SCALE,
  KM_PER_UNIT,
  coneTriangleVertices,
  fanTriangleVertices,
  centroidOf,
  cameraRelativeOffset,
  dskTriangleVertices,
} from './geometry-builders.ts';
export { buildDskGeometry, buildDskMesh } from './dsk-mesh.ts';
export { buildRingVertices, buildRingMesh } from './rings.ts';
export { buildAxisTriad, buildTriadBuffers } from './axis-triad.ts';
export { buildArrow, buildDirectionVectors, type DirectionSpec } from './direction-vectors.ts';
export { buildStarField, buildStarPoints, magnitudeToSize } from './star-field.ts';
export {
  parseStarCatalog,
  radec2vec,
  StarCatalogError,
  type Star,
} from './star-catalog.ts';
export { rayleighCoefficients, buildAtmosphereUniforms, buildAtmosphere } from './atmosphere.ts';
export { computeShadowFrustum, buildSunLight } from './shadows.ts';
export { rowMajor3x3ToMatrix4 } from './orientation.ts';
export { loadSpacecraftModel, normalizeModelRadius, SpacecraftModelError } from './spacecraft-model.ts';
export {
  computeTrackCameraPosition,
  computeOrbitCameraPosition,
  type CameraMode,
} from './camera-modes.ts';
export {
  type SceneSpec,
  type SpacecraftSpec,
  type TrajectorySpec,
  type RingSpec,
  type AxisTriadSpec,
  type AtmosphereSpec,
  type DirectionVectorsSpec,
  type CameraSpec,
  type Rotation3x3,
} from './scene-spec.ts';
export { buildScene, type SceneTarget } from './scene-builder.ts';
