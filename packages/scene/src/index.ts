// @bessel/scene: builds and updates the Three.js scene graph from catalog plus
// SPICE state, with camera-relative rendering (mandatory, CLAUDE.md). Phase 0
// renders textured planet globes and a spacecraft trajectory polyline.

export { SolarSystemScene, type Km3 } from './three-scene.ts';
export { SOLAR_SYSTEM, type PlanetDef } from './planets.ts';
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
export { orbitEllipse, orbitPeriod } from './orbit.ts';
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
export {
  rowMajor3x3ToMatrix4,
  rowMajor3x3ToQuaternion,
  applyAttitude,
  applyQuaternion,
  uniformRotationQuaternion,
} from './orientation.ts';
export { loadSpacecraftModel, normalizeModelRadius, SpacecraftModelError } from './spacecraft-model.ts';
export {
  computeTrackCameraPosition,
  computeOrbitCameraPosition,
  azimuthElevationFromDirection,
  dollyFactor,
  craneOffsetFraction,
  type CameraMode,
} from './camera-modes.ts';
export {
  TextureManager,
  TextureLoadError,
  defaultBodyTextureUrl,
  DEFAULT_BODY_TEXTURE_URLS,
  type TextureCache,
  type TextureManagerDeps,
} from './texture-manager.ts';
export {
  proceduralBodyTexture,
  chooseBodyTextureSource,
  buildBodyMaterial,
  type BodyTextureSource,
  type BodyMaterialDeps,
} from './body-material.ts';
export {
  type SceneSpec,
  type SpacecraftSpec,
  type TrajectorySpec,
  type OrbitSpec,
  type RingSpec,
  type AxisTriadSpec,
  type AtmosphereSpec,
  type DirectionVectorsSpec,
  type CameraSpec,
  type LabelSpec,
  type ParticleSystemSpec,
  type KeplerianSwarmSpec,
  type TimeSwitchedSpec,
  type TimeSwitchedSegmentSpec,
  type Rotation3x3,
  type Rgb01,
} from './scene-spec.ts';
export { activeSegment, type TimeSegment } from './time-switched.ts';
export { buildScene, type SceneTarget } from './scene-builder.ts';
export { pickObjectId, pointerToNdc } from './picking.ts';
export { LabelLayer, projectToScreen, type LabelTarget } from './labels.ts';
export {
  buildParticleSystem,
  buildParticlePositions,
  type ParticleSystemParams,
} from './particle-system.ts';
export {
  buildKeplerianSwarm,
  buildSwarmPositions,
  type KeplerianSwarmParams,
} from './keplerian-swarm.ts';
