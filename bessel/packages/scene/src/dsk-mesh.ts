// DSK shape-model mesh construction from type-2 vertices and plates (read by
// @bessel/spice readDsk). The triangle vertex math is the unit-tested surface
// (dskTriangleVertices in geometry-builders); this wraps it in a shaded mesh.
// A small body like MU69 (tens of km) is sub-pixel at the heliocentric scale, so
// a per-mesh scale override lets a dedicated body view frame it.

import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import { SCALE, dskTriangleVertices } from './geometry-builders.ts';

/** Build a non-indexed, shaded BufferGeometry from DSK vertices (km) and plates. */
export function buildDskGeometry(
  vertices: readonly number[],
  plates: readonly number[],
  scale = SCALE,
): BufferGeometry {
  const positions = dskTriangleVertices(vertices, plates, scale);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Build a shaded mesh for a DSK shape model. */
export function buildDskMesh(
  vertices: readonly number[],
  plates: readonly number[],
  color: readonly [number, number, number] = [0.62, 0.58, 0.52],
  scale = SCALE,
): Mesh {
  const material = new MeshStandardMaterial({
    color: new Color(color[0], color[1], color[2]),
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  return new Mesh(buildDskGeometry(vertices, plates, scale), material);
}
