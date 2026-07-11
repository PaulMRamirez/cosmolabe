// Reference-frame axis triad: RGB line segments for +X (red), +Y (green),
// +Z (blue), anchored at a body and oriented from a SPICE pxform 3x3. Pure vertex
// and color construction so it is unit tested headlessly.

import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import { SCALE } from './geometry-builders.ts';

export interface TriadBuffers {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
}

/** Six vertices (three colored segments from the origin) of length lengthUnits. */
export function buildTriadBuffers(lengthUnits: number): TriadBuffers {
  const L = lengthUnits;
  const positions = new Float32Array([
    0, 0, 0, L, 0, 0, // +X
    0, 0, 0, 0, L, 0, // +Y
    0, 0, 0, 0, 0, L, // +Z
  ]);
  const colors = new Float32Array([
    1, 0.2, 0.2, 1, 0.2, 0.2,
    0.2, 1, 0.2, 0.2, 1, 0.2,
    0.4, 0.6, 1, 0.4, 0.6, 1,
  ]);
  return { positions, colors };
}

/** Build an axis-triad LineSegments object of the given length in km. */
export function buildAxisTriad(lengthKm: number): LineSegments {
  const { positions, colors } = buildTriadBuffers(lengthKm * SCALE);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true }));
}
