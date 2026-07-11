// A deterministic synthetic RSO catalog for demonstrating the all-vs-all conjunction
// screen without ingesting a real space-object catalog (out of scope). Every object is a
// circular two-body orbit sampled analytically on one shared epoch grid (the screen
// requires all objects to share the grid), so the output is a pure function of the inputs:
// no Math.random, no Date.now, no SPICE round-trip. The offsets are chosen so at least one
// pair closes inside a kilometres-scale threshold, making the feature demonstrable.

import type { SampledEphemeris } from '@bessel/conjunction';

/** Earth gravitational parameter (km^3/s^2), for the circular-orbit mean motion. */
const MU_EARTH = 398600.4418;

/** One synthetic object's orbit: a circular orbit defined by its radius and orientation. */
interface SyntheticOrbit {
  readonly id: string;
  /** Circular orbit radius (km from the Earth centre). */
  readonly radiusKm: number;
  /** Right ascension of ascending node (rad), tilts the orbit plane about +z. */
  readonly raanRad: number;
  /** Inclination (rad) of the orbit plane. */
  readonly inclRad: number;
  /** Phase angle (rad) of the object along its orbit at epoch. */
  readonly phaseRad: number;
  /** Hard-body radius (km) reported for the Pc estimate. */
  readonly hardBodyKm: number;
  /** Per-axis 1-sigma position uncertainty (km) reported for the Pc estimate. */
  readonly sigmaKm: number;
}

/**
 * A fixed roster of objects. CHASER and TARGET share the same orbit plane and phase but sit
 * on radial shells 3 km apart, so they co-orbit a constant ~3 km apart and the screen flags
 * the pair below the 5 km threshold; the others sit on distinct shells/planes far enough out
 * that the radial-shell and bounding-box sieve rejects them. Pure constants, so the demo is
 * reproducible run to run. (The tiny radius difference is a deliberate near-miss formation,
 * not a real-orbit ground truth; the goal is a demonstrable flagged conjunction.)
 */
const ROSTER: readonly SyntheticOrbit[] = [
  { id: 'TARGET', radiusKm: 7000, raanRad: 0, inclRad: 0.9, phaseRad: 0, hardBodyKm: 0.005, sigmaKm: 0.4 },
  { id: 'CHASER', radiusKm: 7003, raanRad: 0, inclRad: 0.9, phaseRad: 0, hardBodyKm: 0.004, sigmaKm: 0.4 },
  { id: 'DRIFTER', radiusKm: 7200, raanRad: 0.6, inclRad: 1.1, phaseRad: 1.2, hardBodyKm: 0.003, sigmaKm: 0.5 },
  { id: 'POLAR-1', radiusKm: 7800, raanRad: 1.9, inclRad: 1.5, phaseRad: 2.4, hardBodyKm: 0.006, sigmaKm: 0.6 },
  { id: 'MEO-A', radiusKm: 12000, raanRad: 3.1, inclRad: 0.5, phaseRad: 0.7, hardBodyKm: 0.004, sigmaKm: 0.8 },
];

/** Rotate a vector in the orbit plane out to the inertial frame by inclination then RAAN. */
function toInertial(
  xPlane: number,
  yPlane: number,
  inclRad: number,
  raanRad: number,
): readonly [number, number, number] {
  // Inclination tilts the plane about the x-axis; RAAN then rotates about the z-axis.
  const ci = Math.cos(inclRad);
  const si = Math.sin(inclRad);
  const xi = xPlane;
  const yi = yPlane * ci;
  const zi = yPlane * si;
  const cr = Math.cos(raanRad);
  const sr = Math.sin(raanRad);
  return [xi * cr - yi * sr, xi * sr + yi * cr, zi];
}

/** Analytic state (position km, velocity km/s) of a circular orbit at time t seconds. */
function stateAt(orbit: SyntheticOrbit, t: number): {
  readonly pos: readonly [number, number, number];
  readonly vel: readonly [number, number, number];
} {
  const n = Math.sqrt(MU_EARTH / orbit.radiusKm ** 3); // mean motion (rad/s)
  const theta = orbit.phaseRad + n * t;
  const r = orbit.radiusKm;
  const xPlane = r * Math.cos(theta);
  const yPlane = r * Math.sin(theta);
  const speed = n * r;
  const vxPlane = -speed * Math.sin(theta);
  const vyPlane = speed * Math.cos(theta);
  return {
    pos: toInertial(xPlane, yPlane, orbit.inclRad, orbit.raanRad),
    vel: toInertial(vxPlane, vyPlane, orbit.inclRad, orbit.raanRad),
  };
}

/**
 * Sample one orbit onto a shared absolute-ET grid into a SampledEphemeris. The orbit phase
 * is propagated from the grid's epoch (its first sample), so the analytic state is evaluated
 * at the elapsed time grid[k] - epoch rather than the raw (large) ET value; the stored et
 * stays the shared absolute grid the screen indexes on.
 */
function sampleOrbit(orbit: SyntheticOrbit, grid: Float64Array): SampledEphemeris {
  const n = grid.length;
  const epoch = grid[0]!;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const { pos: p, vel: v } = stateAt(orbit, grid[k]! - epoch);
    pos[k * 3] = p[0];
    pos[k * 3 + 1] = p[1];
    pos[k * 3 + 2] = p[2];
    vel[k * 3] = v[0];
    vel[k * 3 + 1] = v[1];
    vel[k * 3 + 2] = v[2];
  }
  return { id: orbit.id, et: grid, pos, vel, radiusKm: orbit.hardBodyKm, sigmaKm: orbit.sigmaKm };
}

export interface SyntheticCatalogOptions {
  /** Epoch (ET seconds) the shared grid starts at; the demo passes the live timeline epoch. */
  readonly epochEt: number;
  /** Span (seconds) the grid covers from epochEt. */
  readonly spanSec: number;
  /** Number of grid samples (>= 2). */
  readonly steps: number;
}

/** The screen defaults the demo runs with, surfaced so the panel and engine agree. */
export const SYNTHETIC_SCREEN_DEFAULTS = {
  /** Flag pairs that close below this miss distance (km). */
  thresholdKm: 5,
  /** Coarse-sieve margin (km) added to the threshold. */
  padKm: 50,
  spanSec: 5400,
  steps: 600,
} as const;

/**
 * Build the deterministic synthetic catalog on one shared epoch grid. The grid runs from
 * epochEt across spanSec in `steps` strictly-ascending samples, so every object lands on
 * identical epochs and screenAllVsAll's shared-grid assertion holds. Pure: identical inputs
 * yield byte-identical Float64Array contents.
 */
export function buildSyntheticCatalog(opts: SyntheticCatalogOptions): SampledEphemeris[] {
  const steps = Math.max(2, Math.floor(opts.steps));
  const grid = new Float64Array(steps);
  for (let k = 0; k < steps; k++) {
    grid[k] = opts.epochEt + (opts.spanSec * k) / (steps - 1);
  }
  return ROSTER.map((orbit) => sampleOrbit(orbit, grid));
}
