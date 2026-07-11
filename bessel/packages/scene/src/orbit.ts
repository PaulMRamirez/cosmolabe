// Osculating orbit path from a state vector. Given a body's position and velocity
// relative to its central body (km, km/s) and the central GM, compute the
// classical ellipse and sample it, so a full orbit can be drawn from a single
// epoch without ephemeris over the whole period. Pure math, unit-tested headless.

import type { Km3 } from './geometry-builders.ts';

type V3 = readonly [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mag = (a: V3): number => Math.sqrt(dot(a, a));

/** A vector perpendicular to n (any), normalized. */
function perpendicular(n: V3): V3 {
  const ref: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const p = cross(ref, n);
  const m = mag(p) || 1;
  return scale(p, 1 / m);
}

/**
 * Sample the osculating orbit ellipse (km, relative to the central body) from a
 * state vector. Returns a closed polyline (first point repeated at the end), or
 * an empty array for a non-elliptical orbit (e >= 1) or a degenerate state.
 */
export function orbitEllipse(
  position: V3,
  velocity: V3,
  mu: number,
  segments = 128,
): Km3[] {
  const r = mag(position);
  if (r < 1e-9 || mu <= 0) return [];
  const v2 = dot(velocity, velocity);
  const rdotv = dot(position, velocity);
  // Eccentricity vector e = ((v^2 - mu/r) r - (r.v) v) / mu.
  const eVec = scale(sub(scale(position, v2 - mu / r), scale(velocity, rdotv)), 1 / mu);
  const e = mag(eVec);
  if (e >= 0.999) return []; // not a closed ellipse (parabolic/hyperbolic)
  const h = cross(position, velocity);
  const hMag = mag(h);
  if (hMag < 1e-9) return []; // radial / degenerate
  const p = (hMag * hMag) / mu; // semi-latus rectum
  // Perifocal basis: P toward periapsis, W the orbit normal, Q = W x P.
  const W = scale(h, 1 / hMag);
  const P = e > 1e-6 ? scale(eVec, 1 / e) : perpendicular(W);
  const Q = cross(W, P);
  const points: Km3[] = [];
  for (let i = 0; i <= segments; i++) {
    const nu = (i / segments) * Math.PI * 2;
    const rr = p / (1 + e * Math.cos(nu));
    points.push(add(scale(P, rr * Math.cos(nu)), scale(Q, rr * Math.sin(nu))));
  }
  return points;
}

/**
 * Osculating orbital period (seconds) from a state vector, via the vis-viva
 * semi-major axis and Kepler's third law. Returns null for a non-elliptical
 * (parabolic/hyperbolic) or degenerate state, where no period is defined. Used
 * to size the time window when tracing a body's true ephemeris path.
 */
export function orbitPeriod(position: V3, velocity: V3, mu: number): number | null {
  const r = mag(position);
  if (r < 1e-9 || mu <= 0) return null;
  const energy = dot(velocity, velocity) / 2 - mu / r; // specific orbital energy
  if (energy >= 0) return null; // not bound: no closed period
  const a = -mu / (2 * energy); // semi-major axis
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}
