// KeplerianSwarm geometry (Cosmographia geometry type): a cloud of points spread
// over a family of Keplerian orbits, for asteroid belts, ring particles, and
// debris swarms. Each particle's orbital elements are deterministic in its index
// so renders and tests are reproducible. The pure position builder is the
// unit-tested surface; the scene wraps it in a Points cloud anchored at a body.

import { BufferGeometry, Color, Float32BufferAttribute, Points, PointsMaterial } from 'three';
import { SCALE } from './geometry-builders.ts';

export interface KeplerianSwarmParams {
  readonly count: number;
  readonly semiMajorMinKm: number;
  readonly semiMajorMaxKm: number;
  /** Maximum eccentricity (0 = circular). */
  readonly eccentricity: number;
  /** Maximum inclination spread, degrees. */
  readonly inclinationDeg: number;
  readonly color: string;
  readonly sizePx?: number;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 1.37) * 43758.5453;
  return x - Math.floor(x);
}

export function buildSwarmPositions(params: KeplerianSwarmParams): Float32Array {
  const out = new Float32Array(params.count * 3);
  const incMax = (params.inclinationDeg * Math.PI) / 180;
  for (let i = 0; i < params.count; i++) {
    const a =
      params.semiMajorMinKm + (params.semiMajorMaxKm - params.semiMajorMinKm) * rand(i + 1);
    const e = params.eccentricity * rand(i + 53);
    const inc = (rand(i + 109) * 2 - 1) * incMax;
    const node = rand(i + 211) * Math.PI * 2; // longitude of ascending node
    const theta = rand(i + 307) * Math.PI * 2; // true anomaly
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
    // Position in the orbital plane.
    const xp = r * Math.cos(theta);
    const yp = r * Math.sin(theta);
    // Tilt by inclination about the node line, then rotate by the node.
    const cosI = Math.cos(inc);
    const sinI = Math.sin(inc);
    const cosN = Math.cos(node);
    const sinN = Math.sin(node);
    const x = xp * cosN - yp * cosI * sinN;
    const y = xp * sinN + yp * cosI * cosN;
    const z = yp * sinI;
    out[i * 3] = x * SCALE;
    out[i * 3 + 1] = y * SCALE;
    out[i * 3 + 2] = z * SCALE;
  }
  return out;
}

export function buildKeplerianSwarm(params: KeplerianSwarmParams): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buildSwarmPositions(params), 3));
  const material = new PointsMaterial({
    color: new Color(params.color),
    size: params.sizePx ?? 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  return new Points(geometry, material);
}
