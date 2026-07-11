// ParticleSystem geometry (Cosmographia geometry type): a directed spray of
// points from a source, for plumes (Enceladus jets) and dust. Positions are
// deterministic in the particle index so renders and tests are reproducible (no
// Math.random). The pure position builder is the unit-tested surface; the scene
// wraps it in a Points cloud.

import { BufferGeometry, Color, Float32BufferAttribute, Points, PointsMaterial } from 'three';
import { SCALE, type Km3 } from './geometry-builders.ts';

export interface ParticleSystemParams {
  readonly count: number;
  /** Emission direction in km (any length); normalized internally. */
  readonly direction: Km3;
  /** Half-angle of the emission cone, degrees. */
  readonly spreadDeg: number;
  /** Distance particles travel from the source, km. */
  readonly lengthKm: number;
  /** Radius of the source offset, km. */
  readonly baseRadiusKm: number;
  readonly color: string;
  /** Apparent point size in pixels. */
  readonly sizePx?: number;
}

// Deterministic pseudo-random in [0, 1) from an integer seed (hash, not stateful).
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 7.13) * 43758.5453;
  return x - Math.floor(x);
}

function normalize(v: Km3): Km3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Two unit vectors orthogonal to d (and to each other). */
function basis(d: Km3): [Km3, Km3] {
  const ref: Km3 = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u: Km3 = normalize([
    d[1] * ref[2] - d[2] * ref[1],
    d[2] * ref[0] - d[0] * ref[2],
    d[0] * ref[1] - d[1] * ref[0],
  ]);
  const v: Km3 = [
    d[1] * u[2] - d[2] * u[1],
    d[2] * u[0] - d[0] * u[2],
    d[0] * u[1] - d[1] * u[0],
  ];
  return [u, v];
}

export function buildParticlePositions(params: ParticleSystemParams): Float32Array {
  const dir = normalize(params.direction);
  const [u, v] = basis(dir);
  const spread = (params.spreadDeg * Math.PI) / 180;
  const out = new Float32Array(params.count * 3);
  for (let i = 0; i < params.count; i++) {
    const t = rand(i + 1); // fraction along the jet
    const angle = rand(i + 101) * Math.PI * 2;
    const radial = rand(i + 211) * spread * t; // widens with distance
    const along = params.baseRadiusKm + t * params.lengthKm;
    const lateral = Math.tan(radial) * along;
    const x = dir[0] * along + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * lateral;
    const y = dir[1] * along + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * lateral;
    const z = dir[2] * along + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * lateral;
    out[i * 3] = x * SCALE;
    out[i * 3 + 1] = y * SCALE;
    out[i * 3 + 2] = z * SCALE;
  }
  return out;
}

export function buildParticleSystem(params: ParticleSystemParams): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buildParticlePositions(params), 3));
  const material = new PointsMaterial({
    color: new Color(params.color),
    size: params.sizePx ?? 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  return new Points(geometry, material);
}
