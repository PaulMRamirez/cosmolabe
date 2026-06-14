// Pure geometry builders, separated from the WebGL scene so they can be unit
// tested headlessly (vitest runs in node, where a real WebGLRenderer cannot be
// constructed). The scene composes these into BufferGeometry; the math lives here.

export const KM_PER_UNIT = 1_000_000;
export const SCALE = 1 / KM_PER_UNIT;

export type Km3 = readonly [number, number, number];

/** Triangle-fan vertices for an FOV cone: apex to each rim edge. Returns 3*rim.length triangles. */
export function coneTriangleVertices(apex: Km3, rim: readonly Km3[], scale = SCALE): Float32Array {
  const tris: number[] = [];
  const push = (p: Km3): void => {
    tris.push(p[0] * scale, p[1] * scale, p[2] * scale);
  };
  for (let i = 0; i < rim.length; i++) {
    push(apex);
    push(rim[i]!);
    push(rim[(i + 1) % rim.length]!);
  }
  return new Float32Array(tris);
}

/** Centroid of a set of points. */
export function centroidOf(points: readonly Km3[]): Km3 {
  const n = points.length || 1;
  return [
    points.reduce((s, p) => s + p[0], 0) / n,
    points.reduce((s, p) => s + p[1], 0) / n,
    points.reduce((s, p) => s + p[2], 0) / n,
  ];
}

/** Triangle-fan vertices for a footprint patch around its centroid, lifted radially. */
export function fanTriangleVertices(points: readonly Km3[], scale = SCALE, lift = 1): Float32Array {
  const centroid = centroidOf(points);
  const tris: number[] = [];
  const push = (p: Km3): void => {
    tris.push(p[0] * lift * scale, p[1] * lift * scale, p[2] * lift * scale);
  };
  for (let i = 0; i < points.length; i++) {
    push(centroid);
    push(points[i]!);
    push(points[(i + 1) % points.length]!);
  }
  return new Float32Array(tris);
}

/** Camera-relative (floating-origin) offset: position minus focus, scaled. Mandatory invariant. */
export function cameraRelativeOffset(
  posKm: Km3,
  focusKm: Km3,
  scale = SCALE,
): [number, number, number] {
  return [(posKm[0] - focusKm[0]) * scale, (posKm[1] - focusKm[1]) * scale, (posKm[2] - focusKm[2]) * scale];
}

/** Non-indexed triangle positions for a DSK mesh: three vertices per plate, scaled. */
export function dskTriangleVertices(
  vertices: readonly number[],
  plates: readonly number[],
  scale = SCALE,
): Float32Array {
  const out = new Float32Array(plates.length * 3);
  for (let i = 0; i < plates.length; i++) {
    const v = plates[i]! * 3;
    out[i * 3] = vertices[v]! * scale;
    out[i * 3 + 1] = vertices[v + 1]! * scale;
    out[i * 3 + 2] = vertices[v + 2]! * scale;
  }
  return out;
}
