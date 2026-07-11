import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, SphereGeometry } from 'three';
import { pickObjectId, pointerToNdc } from './picking.ts';

describe('pointerToNdc', () => {
  it('maps the element center to the origin and corners to the unit square', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(pointerToNdc(50, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToNdc(0, 0, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(100, 100, rect)).toEqual({ x: 1, y: -1 });
  });
});

describe('pickObjectId', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const mesh = new Mesh(new SphereGeometry(1, 16, 8), new MeshBasicMaterial());
  mesh.userData['objectId'] = 'Saturn';
  mesh.updateMatrixWorld();

  it('returns the id of a mesh under the ray', () => {
    expect(pickObjectId(new Raycaster(), camera, 0, 0, [mesh])).toBe('Saturn');
  });

  it('returns null when the ray misses every candidate', () => {
    expect(pickObjectId(new Raycaster(), camera, 0.98, 0.98, [mesh])).toBeNull();
  });

  it('ignores meshes without an objectId', () => {
    const bare = new Mesh(new SphereGeometry(1, 16, 8), new MeshBasicMaterial());
    bare.updateMatrixWorld();
    expect(pickObjectId(new Raycaster(), camera, 0, 0, [bare])).toBeNull();
  });
});
