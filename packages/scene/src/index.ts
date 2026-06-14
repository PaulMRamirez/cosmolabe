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

/** Camera modes the controller supports (SPEC 5.3). */
export type CameraMode = 'orbit' | 'center' | 'track';
