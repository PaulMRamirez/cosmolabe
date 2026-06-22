// Validates the solar beta angle two ways: (1) a constructed-geometry fake engine
// where r, v, and the Sun direction are chosen so beta is known by hand, asserting
// bounds, sign, and an exact analytic value; (2) a real Cassini/Saturn fixture case
// asserting betaAngle equals an independently computed asin(s_hat . h_hat). (Phase B.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createSpiceEngine,
  type SpiceEngine,
  type StateVector,
  type PositionResult,
  type Vec3,
} from '@bessel/spice';
import { betaAngle, betaAngleSeries, DegenerateOrbitError } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const CASSINI = '-82';

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const mag = (a: Vec3) => Math.sqrt(dot(a, a));

/**
 * A minimal SpiceEngine that answers only spkezr (the observer state) and spkpos
 * (the Sun direction) from fixed vectors. Every other member throws, so the test
 * exercises exactly the beta path. The throwing proxy keeps us honest: an extra
 * SPICE dependency would fail loudly rather than pass silently.
 */
function fakeEngine(state: { position: Vec3; velocity: Vec3 }, sun: Vec3): SpiceEngine {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'spkezr') {
        return async (): Promise<StateVector> => ({
          position: state.position,
          velocity: state.velocity,
          lightTime: 0,
        });
      }
      if (prop === 'spkpos') {
        return async (): Promise<PositionResult> => ({ position: sun, lightTime: 0 });
      }
      return () => {
        throw new Error(`fakeEngine: unexpected SPICE call ${String(prop)}`);
      };
    },
  };
  return new Proxy({}, handler) as SpiceEngine;
}

describe('@bessel/events betaAngle (constructed geometry)', () => {
  it('returns +30 deg for a Sun 30 deg above the orbit plane', async () => {
    // Orbit in the x-y plane: r=+x, v=+y -> h = r x v = +z. Sun at 30 deg elevation
    // above the x-y plane: s = (cos30, 0, sin30). beta = asin(sin30) = 30.
    const r = { x: 7000, y: 0, z: 0 };
    const v = { x: 0, y: 7.5, z: 0 };
    const s = { x: Math.cos(Math.PI / 6) * 1.5e8, y: 0, z: Math.sin(Math.PI / 6) * 1.5e8 };
    const spice = fakeEngine({ position: r, velocity: v }, s);
    const beta = await betaAngle(spice, 'SAT', 'EARTH', 0);
    expect(beta).toBeCloseTo(30, 9);
    expect(beta).toBeGreaterThanOrEqual(-90);
    expect(beta).toBeLessThanOrEqual(90);
  });

  it('flips sign with the orbit normal (s . h < 0 -> beta < 0)', async () => {
    // Reverse velocity -> h = -z; same Sun above the plane now sits "below" h.
    const r = { x: 7000, y: 0, z: 0 };
    const v = { x: 0, y: -7.5, z: 0 };
    const s = { x: Math.cos(Math.PI / 6) * 1.5e8, y: 0, z: Math.sin(Math.PI / 6) * 1.5e8 };
    const spice = fakeEngine({ position: r, velocity: v }, s);
    const beta = await betaAngle(spice, 'SAT', 'EARTH', 0);
    expect(beta).toBeCloseTo(-30, 9);
    const h = cross(r, v);
    expect(Math.sign(beta)).toBe(Math.sign(dot(s, h)));
  });

  it('is bounded at +-90 when the Sun is along the orbit normal', async () => {
    const r = { x: 7000, y: 0, z: 0 };
    const v = { x: 0, y: 7.5, z: 0 };
    const s = { x: 0, y: 0, z: 1.5e8 };
    const spice = fakeEngine({ position: r, velocity: v }, s);
    expect(await betaAngle(spice, 'SAT', 'EARTH', 0)).toBeCloseTo(90, 9);
  });

  it('throws DegenerateOrbitError on a radial (zero h) state', async () => {
    const r = { x: 7000, y: 0, z: 0 };
    const v = { x: 7.5, y: 0, z: 0 }; // parallel to r -> h = 0
    const s = { x: 0, y: 0, z: 1.5e8 };
    const spice = fakeEngine({ position: r, velocity: v }, s);
    await expect(betaAngle(spice, 'SAT', 'EARTH', 0)).rejects.toBeInstanceOf(DegenerateOrbitError);
  });
});

describe('@bessel/events betaAngle (Cassini/Saturn fixture)', () => {
  let spice: SpiceEngine;
  let et: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    et = await spice.str2et('2004-07-01T03:00:00');
  });

  it('equals an independently computed asin(s_hat . h_hat)', async () => {
    const state = await spice.spkezr(CASSINI, et, 'J2000', 'NONE', 'SATURN');
    const sun = await spice.spkpos('SUN', et, 'J2000', 'NONE', 'SATURN');
    const h = cross(state.position, state.velocity);
    const expectedDeg = (Math.asin(dot(sun.position, h) / (mag(sun.position) * mag(h))) * 180) / Math.PI;
    const beta = await betaAngle(spice, CASSINI, 'SATURN', et);
    expect(beta).toBeCloseTo(expectedDeg, 9);
    expect(beta).toBeGreaterThanOrEqual(-90);
    expect(beta).toBeLessThanOrEqual(90);
    expect(Math.sign(beta)).toBe(Math.sign(dot(sun.position, h)));
  });

  it('betaAngleSeries samples the span and stays bounded', async () => {
    const series = await betaAngleSeries(spice, CASSINI, 'SATURN', [et, et + 3600], 600);
    expect(series.et.length).toBe(7);
    expect(series.valueDeg.length).toBe(7);
    for (const v of series.valueDeg) {
      expect(v).toBeGreaterThanOrEqual(-90);
      expect(v).toBeLessThanOrEqual(90);
    }
    expect(series.valueDeg[0]).toBeCloseTo(await betaAngle(spice, CASSINI, 'SATURN', et), 9);
  });
});
