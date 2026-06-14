import { describe, it, expect } from 'vitest';
import {
  SCALE,
  cameraRelativeOffset,
  centroidOf,
  coneTriangleVertices,
  dskTriangleVertices,
  fanTriangleVertices,
  type Km3,
} from './index.ts';

describe('@bessel/scene geometry builders', () => {
  it('builds an FOV cone with 3 vertices per rim edge', () => {
    const apex: Km3 = [0, 0, 0];
    const rim: Km3[] = [
      [1e6, 0, 0],
      [0, 1e6, 0],
      [0, 0, 1e6],
      [1e6, 1e6, 0],
    ];
    const v = coneTriangleVertices(apex, rim);
    // N rim points yield N triangles, each 3 vertices, each 3 floats.
    expect(v.length).toBe(rim.length * 3 * 3);
    // Apex of the first triangle is the scaled apex (origin).
    expect(v[0]).toBe(0);
  });

  it('builds a footprint fan with a centroid and lifts it above the surface', () => {
    const points: Km3[] = [
      [100, 0, 0],
      [0, 100, 0],
      [-100, 0, 0],
      [0, -100, 0],
    ];
    const v = fanTriangleVertices(points, SCALE, 1.02);
    expect(v.length).toBe(points.length * 3 * 3);
    // The centroid of a symmetric quad is the origin.
    const c = centroidOf(points);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    // First fan vertex is the lifted centroid (origin stays origin).
    expect(v[0]).toBe(0);
  });

  it('keeps camera-relative coordinates small near the focus (floating-origin invariant)', () => {
    // Saturn at ~1.35e9 km from the Sun; with the focus on Saturn the offset is tiny.
    const saturn: Km3 = [-3.8e8, 1.19e9, 5.09e8];
    const offset = cameraRelativeOffset(saturn, saturn);
    expect(Math.hypot(...offset)).toBe(0);
    // A nearby spacecraft at 80,000 km maps to 0.08 scene units, well within float32.
    const cassini: Km3 = [saturn[0] + 8e4, saturn[1], saturn[2]];
    const rel = cameraRelativeOffset(cassini, saturn);
    expect(Math.abs(rel[0])).toBeCloseTo(0.08, 5);
    expect(Math.hypot(...rel)).toBeLessThan(1);
  });

  it('builds a DSK mesh as three non-indexed vertices per plate', () => {
    // A tetrahedron: 4 vertices, 4 triangular plates (0-based indices).
    const vertices = [0, 0, 0, 1e6, 0, 0, 0, 1e6, 0, 0, 0, 1e6];
    const plates = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
    const v = dskTriangleVertices(vertices, plates);
    expect(v.length).toBe(plates.length * 3); // 12 indices * 3 floats = 36
    // Vertex 1 (1e6,0,0) scaled is (1,0,0).
    expect(v[3]).toBeCloseTo(1, 6);
  });
});
