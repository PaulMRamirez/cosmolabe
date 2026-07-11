// 3D picking: cast a ray from the camera through a normalized device coordinate
// and return the objectId of the nearest pickable mesh. Pickable meshes carry
// their id on userData.objectId (set by the scene). The raycaster respects the
// camera-relative world transform because it reads matrixWorld, which is current
// after each render.

import { Vector2 } from 'three';
import type { Camera, Object3D, Raycaster } from 'three';

export function pickObjectId(
  raycaster: Raycaster,
  camera: Camera,
  ndcX: number,
  ndcY: number,
  candidates: readonly Object3D[],
): string | null {
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const hits = raycaster.intersectObjects(candidates as Object3D[], false);
  for (const hit of hits) {
    const id = hit.object.userData['objectId'];
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Convert a pointer event position within an element to NDC in [-1, 1]. */
export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}
