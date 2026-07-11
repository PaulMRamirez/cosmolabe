// Star field rendering: a Points cloud on a large fixed-radius celestial sphere.
// The field is parented to the camera (or a non-translated group) so stars stay
// effectively at infinity regardless of the floating-origin focus shift.

import { BufferGeometry, Float32BufferAttribute, Points, PointsMaterial } from 'three';
import { radec2vec, type Star } from './star-catalog.ts';

/** Celestial sphere radius in scene units (large, beyond the solar system). */
const STAR_SPHERE = 5e5;

export interface StarPoints {
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
}

/** Map magnitude to a point size (brighter stars larger). */
export function magnitudeToSize(mag: number): number {
  return Math.max(0.4, 2.6 - 0.32 * mag);
}

/** Build star point positions on the celestial sphere and per-star sizes. */
export function buildStarPoints(stars: readonly Star[], radius = STAR_SPHERE): StarPoints {
  const positions = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  stars.forEach((s, i) => {
    const v = radec2vec(s.ra, s.dec);
    positions[i * 3] = v[0] * radius;
    positions[i * 3 + 1] = v[1] * radius;
    positions[i * 3 + 2] = v[2] * radius;
    sizes[i] = magnitudeToSize(s.mag);
  });
  return { positions, sizes };
}

/** Build a star-field Points object from a parsed catalog. */
export function buildStarField(stars: readonly Star[]): Points {
  const { positions } = buildStarPoints(stars);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // Constant 1.6 px points (no distance attenuation): at the 5e5-unit celestial
  // sphere radius an attenuated size collapses to sub-pixel and the stars vanish.
  const material = new PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    sizeAttenuation: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
