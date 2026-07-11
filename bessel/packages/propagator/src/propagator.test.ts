// Validates the analytic propagators. J2 secular rates are checked against closed
// forms and the well-known ISS nodal regression; the mean-element propagator is
// checked by reading the propagated state's elements back via CSPICE oscelt; and
// two-body propagation closes over a period. (STK_PARITY_SPEC §4.1.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import {
  secularRatesJ2,
  propagateTwoBody,
  propagateMeanElements,
  type CentralBody,
  type ClassicalElements,
} from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

// Earth gravity constants (EGM/WGS-84).
const EARTH: CentralBody = { gm: 398600.4418, j2: 1.08262668e-3, re: 6378.137 };
const RAD_S_TO_DEG_DAY = (180 / Math.PI) * 86400;

describe('secularRatesJ2', () => {
  it('reduces to pure two-body when J2 is zero', () => {
    const r = secularRatesJ2(7000, 0.01, 0.9, { ...EARTH, j2: 0 });
    expect(Math.abs(r.raanDot)).toBe(0);
    expect(Math.abs(r.argpDot)).toBe(0);
    expect(r.mDot).toBeCloseTo(Math.sqrt(EARTH.gm / 7000 ** 3), 12); // n0
  });

  it('matches the ISS nodal regression (~ -5 deg/day)', () => {
    const r = secularRatesJ2(6778, 0, 51.6 * (Math.PI / 180), EARTH);
    expect(r.raanDot * RAD_S_TO_DEG_DAY).toBeCloseTo(-5.0, 1);
  });

  it('zeros apsidal rotation at the critical inclination (arccos(1/sqrt(5)))', () => {
    const critical = Math.acos(1 / Math.sqrt(5)); // 63.4349... deg, exact
    const r = secularRatesJ2(7000, 0.001, critical, EARTH);
    // argpDot is ~10 orders of magnitude below a typical apsidal rate here.
    expect(Math.abs(r.argpDot)).toBeLessThan(1e-15);
  });

  it('has no nodal regression at polar inclination', () => {
    const r = secularRatesJ2(7000, 0.001, Math.PI / 2, EARTH);
    expect(Math.abs(r.raanDot)).toBeLessThan(1e-18);
  });

  it('applies the J4 secular correction (j4 shifts the node and perigee drift)', () => {
    const i = 51.6 * (Math.PI / 180);
    const withoutJ4 = secularRatesJ2(7000, 0.01, i, EARTH); // j4 unset -> J2 only
    const withJ4 = secularRatesJ2(7000, 0.01, i, { ...EARTH, j4: -1.61962159e-6 });
    // J4 must measurably move the node and perigee drift away from the J2-only values, and the
    // correction must be finite and small relative to the J2 terms (a higher-order perturbation).
    expect(withJ4.raanDot).not.toBe(withoutJ4.raanDot);
    expect(withJ4.argpDot).not.toBe(withoutJ4.argpDot);
    expect(Number.isFinite(withJ4.raanDot)).toBe(true);
    expect(Number.isFinite(withJ4.argpDot)).toBe(true);
    const dRaan = Math.abs(withJ4.raanDot - withoutJ4.raanDot);
    expect(dRaan).toBeGreaterThan(0);
    expect(dRaan).toBeLessThan(Math.abs(withoutJ4.raanDot)); // a correction, not a dominant term
  });

  it('reduces to the J2-only rates when j4 is zero', () => {
    const i = 51.6 * (Math.PI / 180);
    const unset = secularRatesJ2(7000, 0.01, i, EARTH);
    const zero = secularRatesJ2(7000, 0.01, i, { ...EARTH, j4: 0 });
    expect(zero.raanDot).toBe(unset.raanDot);
    expect(zero.argpDot).toBe(unset.argpDot);
    expect(zero.mDot).toBe(unset.mDot);
  });
});

describe('analytic propagators', () => {
  let spice: SpiceEngine;
  let epoch: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls']) await spice.furnsh(k, fixture(k));
    epoch = await spice.str2et('2020-01-01T00:00:00');
  });

  const ELEMENTS = (): ClassicalElements => ({
    a: 7000,
    e: 0.01,
    i: 51.6 * (Math.PI / 180),
    raan: 1.0,
    argp: 0.5,
    m0: 0.2,
    epoch,
  });

  it('mean-element propagation drifts the node at the secular rate (read back via oscelt)', async () => {
    const el = ELEMENTS();
    const rates = secularRatesJ2(el.a, el.e, el.i, EARTH);
    const dt = 3600; // one hour
    const grid = new Float64Array([epoch, epoch + dt]);
    const table = await propagateMeanElements(spice, el, EARTH, grid);

    // Read the propagated state's osculating elements back with CSPICE.
    const elAtDt = await spice.oscelt(
      { position: { x: table.x[1]!, y: table.y[1]!, z: table.z[1]! }, velocity: { x: table.vx[1]!, y: table.vy[1]!, z: table.vz[1]! } },
      epoch + dt,
      EARTH.gm,
    );
    // The node has advanced by raanDot*dt (wrap to [0,2pi)); inclination is fixed.
    const expectedRaan = (el.raan + rates.raanDot * dt) % (2 * Math.PI);
    expect(elAtDt.lnode).toBeCloseTo(expectedRaan, 6);
    expect(elAtDt.inc).toBeCloseTo(el.i, 6);
  });

  it('with J2 = 0 the node does not drift and the orbit is Keplerian', async () => {
    const el = ELEMENTS();
    const grid = new Float64Array([epoch, epoch + 3600]);
    const table = await propagateMeanElements(spice, el, { ...EARTH, j2: 0 }, grid);
    const elAtDt = await spice.oscelt(
      { position: { x: table.x[1]!, y: table.y[1]!, z: table.z[1]! }, velocity: { x: table.vx[1]!, y: table.vy[1]!, z: table.vz[1]! } },
      epoch + 3600,
      EARTH.gm,
    );
    expect(elAtDt.lnode).toBeCloseTo(el.raan, 6); // no nodal drift
  });

  it('two-body propagation closes over one orbital period', async () => {
    const a = 7000;
    const n0 = Math.sqrt(EARTH.gm / a ** 3);
    const period = (2 * Math.PI) / n0;
    // A near-circular state in the equatorial plane.
    const v = Math.sqrt(EARTH.gm / a);
    const state = { position: { x: a, y: 0, z: 0 }, velocity: { x: 0, y: v, z: 0 } };
    const grid = new Float64Array([epoch, epoch + period]);
    const table = await propagateTwoBody(spice, state, EARTH.gm, epoch, grid);
    expect(table.x[1]).toBeCloseTo(state.position.x, 3);
    expect(table.y[1]).toBeCloseTo(state.position.y, 3);
    expect(table.vy[1]).toBeCloseTo(state.velocity.y, 6);
  });
});
