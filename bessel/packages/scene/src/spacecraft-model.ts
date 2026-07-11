// GLTF spacecraft model loading. Parses a glTF (string for .gltf, ArrayBuffer for
// .glb) via three's GLTFLoader and normalizes the bounding sphere to a target
// radius. Fails loudly with a typed error so the scene can fall back to the marker
// sphere visibly rather than silently.

import { Box3, type Group, Sphere } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SCALE } from './geometry-builders.ts';

export class SpacecraftModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpacecraftModelError';
  }
}

/** Scale a model group so its bounding-sphere radius equals radiusKm in scene units. */
export function normalizeModelRadius(group: Group, radiusKm: number): Group {
  const box = new Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new Sphere());
  const target = radiusKm * SCALE;
  const factor = sphere.radius > 1e-12 ? target / sphere.radius : 1;
  group.scale.setScalar(factor);
  return group;
}

/** Parse a glTF/glb and return a normalized model group. */
export function loadSpacecraftModel(data: string | ArrayBuffer, radiusKm: number): Promise<Group> {
  return new Promise<Group>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(
      data,
      '',
      (gltf) => {
        try {
          resolve(normalizeModelRadius(gltf.scene, radiusKm));
        } catch (err) {
          reject(new SpacecraftModelError(`Failed to normalize model: ${String(err)}`));
        }
      },
      (err) => reject(new SpacecraftModelError(`Failed to parse glTF: ${String(err)}`)),
    );
  });
}
