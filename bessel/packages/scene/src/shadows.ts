// Shadow mapping support. The Sun is modeled as a directional light; this derives
// the orthographic shadow-camera frustum that encloses the focused body. The
// frustum math is pure and unit tested; enabling the shadow map is a scene concern.

import { DirectionalLight } from 'three';

export interface ShadowFrustum {
  readonly near: number;
  readonly far: number;
  readonly halfExtent: number;
}

/**
 * Orthographic shadow frustum that encloses a sphere of the given radius (scene
 * units) with margin, the light placed `distance` away along the sun direction.
 */
export function computeShadowFrustum(radius: number, distance: number): ShadowFrustum {
  const margin = 1.4;
  const half = radius * margin;
  return {
    near: Math.max(0.001, distance - half),
    far: distance + half,
    halfExtent: half,
  };
}

/** Build a shadow-casting directional light (the Sun) for the given body radius. */
export function buildSunLight(radiusScene: number, distanceScene: number): DirectionalLight {
  const light = new DirectionalLight(0xfff4e0, 2.2);
  light.castShadow = true;
  const f = computeShadowFrustum(radiusScene, distanceScene);
  light.shadow.camera.near = f.near;
  light.shadow.camera.far = f.far;
  light.shadow.camera.left = -f.halfExtent;
  light.shadow.camera.right = f.halfExtent;
  light.shadow.camera.top = f.halfExtent;
  light.shadow.camera.bottom = -f.halfExtent;
  light.shadow.mapSize.set(1024, 1024);
  return light;
}
