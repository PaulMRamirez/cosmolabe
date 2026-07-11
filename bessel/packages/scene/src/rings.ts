// Planetary ring geometry (Saturn). An annulus in the body equatorial plane with
// radial UVs so a banded texture maps along the radius. Pure builders so the
// vertex math is unit tested headlessly; the scene wraps it in a mesh.

import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  type Texture,
} from 'three';
import { linearRamp } from '@bessel/color';
import { SCALE } from './geometry-builders.ts';

export interface RingVertices {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: number[];
}

/** Build an annulus (inner..outer km) in the XY plane, segments around. */
export function buildRingVertices(
  innerRadiusKm: number,
  outerRadiusKm: number,
  segments = 96,
  scale = SCALE,
): RingVertices {
  const inner = innerRadiusKm * scale;
  const outer = outerRadiusKm * scale;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    positions.push(inner * cos, inner * sin, 0, outer * cos, outer * sin, 0);
    // Cosmographia/VESTA rings sample a 1-D radial strip: the inner-edge vertex
    // is UV (0,0), the outer-edge vertex is UV (1,0). U is the radial direction
    // (inner -> outer) and only v=0 is sampled, so V does not vary around the
    // ring. See PlanetaryRings.cpp (thirdparty/vesta).
    uvs.push(0, 0, 1, 0);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices,
  };
}

/** Radial fraction (inner..outer) of the Cassini Division for Saturn's rings. */
const CASSINI_FRACTION = 0.62;
const CASSINI_HALF_WIDTH = 0.03;

/**
 * Procedural ring strip: a width=N, height=1 horizontal texture where U is the
 * radial direction (inner -> outer), matching the v=0 strip the ring geometry
 * samples. Alpha carves a real Cassini-Division gap so rings read without an
 * image asset. Returns the same axis orientation as a Cosmographia ring PNG.
 */
export function bandedRingTexture(color: readonly [number, number, number]): DataTexture {
  const w = 64;
  const data = new Uint8Array(w * 4);
  // A two-stop palette across the radius via @bessel/color (shared band ramp).
  const ramp = linearRamp(
    'ring',
    { r: color[0] * 0.6, g: color[1] * 0.6, b: color[2] * 0.6 },
    { r: color[0], g: color[1], b: color[2] },
  );
  for (let x = 0; x < w; x++) {
    const frac = x / (w - 1);
    const rgb = ramp.color(frac, [0, 1]);
    // Fine ringlet structure modulates brightness; the Cassini gap drops alpha.
    const ringlet = 0.7 + 0.3 * Math.sin(frac * 48);
    const inGap = Math.abs(frac - CASSINI_FRACTION) < CASSINI_HALF_WIDTH;
    const i = x * 4;
    data[i] = Math.min(255, rgb.r * 255 * ringlet);
    data[i + 1] = Math.min(255, rgb.g * 255 * ringlet);
    data[i + 2] = Math.min(255, rgb.b * 255 * ringlet);
    data[i + 3] = inGap ? 0 : Math.round(210 * (0.5 + 0.5 * ringlet));
  }
  const tex = new DataTexture(data, w, 1, RGBAFormat);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build a ring mesh (translucent, double-sided) for a planet. Uses the provided
 * image texture when given (a catalog ring texture), else the procedural banded
 * texture so rings always read without bundling assets.
 */
export function buildRingMesh(
  innerRadiusKm: number,
  outerRadiusKm: number,
  color: readonly [number, number, number] = [0.86, 0.8, 0.66],
  texture?: Texture,
): Mesh {
  const v = buildRingVertices(innerRadiusKm, outerRadiusKm);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(v.positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(v.uvs, 2));
  geometry.setIndex(v.indices);
  geometry.computeVertexNormals();
  const map = texture ?? bandedRingTexture(color);
  // The strip's horizontal axis is the radial direction; clamp both axes so the
  // single v=0 row is not tiled (Cosmographia wraps T, but the geometry samples
  // only v=0 so clamping T is equivalent and avoids edge bleed).
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  const material = new MeshBasicMaterial({
    // Opacity 0.99 with the PNG/strip alpha driving the gaps (matches VESTA's
    // RingParticles material); a hard low opacity would double-attenuate a real
    // image.
    map,
    color: new Color(1, 1, 1),
    transparent: true,
    opacity: 0.99,
    side: DoubleSide,
    depthWrite: false,
  });
  return new Mesh(geometry, material);
}
