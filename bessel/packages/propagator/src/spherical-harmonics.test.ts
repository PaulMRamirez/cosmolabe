// Full NxN spherical-harmonic gravity. Independent oracles (not circular):
//   (1) C[2][0] = -J2/sqrt(5) (the normalized form of the unnormalized C_{2,0} = -J2)
//       must reproduce zonal.ts's J2 acceleration to tight tolerance (cross-check).
//   (2) the same configuration must drift the node and periapsis at the analytic
//       secularRatesJ2 rates (reuse the force-model.test.ts oracle, no fixture).
//   (3) a tesseral term (C22/S22) must produce a longitude-dependent acceleration that
//       matches a direct finite-difference gradient of the geopotential it implements.
//   (4) the effective da/dr (the model FD fallback) matches a central difference of a.
// References: Montenbruck & Gill section 3.2.4; Vallado section 8.6. (STK_PARITY_SPEC 4.2.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type CartesianState, type SpiceEngine } from '@bessel/spice';
import { propagateCowell } from './cowell.ts';
import { secularRatesJ2, type EphemerisTable } from './elements.ts';
import { createForceModel } from './force/model.ts';
import { pointMass } from './force/point-mass.ts';
import { zonalHarmonics } from './force/zonal.ts';
import { sphericalHarmonics, fixedRotation } from './force/spherical-harmonics.ts';
import type { ForceContext, ForceTerm, Mat3, Vector3 } from './force/types.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const EARTH = { gm: 398600.4418, j2: 1.08262668e-3, re: 6378.137 };
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Cbar/Sbar with only C[2][0] nonzero (= -J2/sqrt(5)), the normalized J2-only field. */
function j2Field(j2: number) {
  const cbar = [[0], [0, 0], [-j2 / Math.sqrt(5), 0, 0]];
  const sbar = [[0], [0, 0], [0, 0, 0]];
  return { cbar, sbar };
}

const unwrap = (a: number[]): number[] => {
  const out = [a[0]!];
  for (let i = 1; i < a.length; i++) {
    let d = a[i]! - a[i - 1]!;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(out[i - 1]! + d);
  }
  return out;
};
const slope = (t: number[], y: number[]): number => {
  const n = t.length;
  const tb = t.reduce((s, v) => s + v, 0) / n;
  const yb = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (t[i]! - tb) * (y[i]! - yb);
    den += (t[i]! - tb) ** 2;
  }
  return num / den;
};
const row = (t: EphemerisTable, k: number): CartesianState => ({
  position: { x: t.x[k]!, y: t.y[k]!, z: t.z[k]! },
  velocity: { x: t.vx[k]!, y: t.vy[k]!, z: t.vz[k]! },
});

const fdDadr = (term: ForceTerm, ctx: ForceContext): number[] => {
  const out = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    const r = [ctx.r[0], ctx.r[1], ctx.r[2]];
    const h = Math.max(1, Math.abs(r[j]!)) * 1e-6;
    const rp = [...r] as [number, number, number];
    const rm = [...r] as [number, number, number];
    rp[j] = r[j]! + h;
    rm[j] = r[j]! - h;
    const ap = term.acceleration({ et: ctx.et, r: rp, v: ctx.v });
    const am = term.acceleration({ et: ctx.et, r: rm, v: ctx.v });
    for (let i = 0; i < 3; i++) out[i * 3 + j] = (ap[i]! - am[i]!) / (2 * h);
  }
  return out;
};

describe('sphericalHarmonics: J2-only cross-check vs zonalHarmonics', () => {
  const { cbar, sbar } = j2Field(EARTH.j2);
  const sh = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(IDENTITY) });
  const zonal = zonalHarmonics(EARTH, { j2: EARTH.j2 });

  const samples: Vector3[] = [
    [7000, 1200, -400],
    [6800, 0, 2500],
    [-5000, 4000, 3000],
    [3000, -3000, -6000],
  ];

  it('reproduces the zonal J2 acceleration to tight tolerance', () => {
    for (const r of samples) {
      const ctx: ForceContext = { et: 0, r, v: [0, 0, 0] };
      const a = sh.acceleration(ctx);
      const b = zonal.acceleration(ctx);
      for (let i = 0; i < 3; i++) expect(a[i]!).toBeCloseTo(b[i]!, 14);
    }
  });
});

describe('sphericalHarmonics: J2-only drives the secular rates', () => {
  let spice: SpiceEngine;
  const a = 6778;
  const e = 0.05;
  const i = (51.6 * Math.PI) / 180;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    await spice.furnsh('naif0012.tls', fixture('naif0012.tls'));
  });

  it('drifts the node and periapsis at the analytic secularRatesJ2 rates', async () => {
    const el0 = { rp: a * (1 - e), ecc: e, inc: i, lnode: 0.7, argp: 0.5, m0: 0, t0: 0, mu: EARTH.gm };
    const s0 = await spice.conics(el0, 0);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / EARTH.gm);
    const grid = Float64Array.from({ length: 20 * 15 + 1 }, (_, k) => (k * period) / 20);
    const { cbar, sbar } = j2Field(EARTH.j2);
    const sh = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(IDENTITY) });
    const fm = createForceModel([pointMass(EARTH.gm), sh]);
    const table = propagateCowell({ state: s0, epoch: 0, etGrid: grid, forceModel: fm });
    const t: number[] = [];
    const raan: number[] = [];
    const argp: number[] = [];
    for (let k = 0; k < grid.length; k++) {
      const el = await spice.oscelt(row(table, k), grid[k]!, EARTH.gm);
      t.push(grid[k]!);
      raan.push(el.lnode);
      argp.push(el.argp);
    }
    const ref = secularRatesJ2(a, e, i, EARTH);
    const raanDot = slope(t, unwrap(raan));
    const argpDot = slope(t, unwrap(argp));
    expect(raanDot).toBeLessThan(0);
    expect(Math.abs(raanDot - ref.raanDot) / Math.abs(ref.raanDot)).toBeLessThan(0.1);
    expect(argpDot).toBeGreaterThan(0);
    expect(Math.abs(argpDot - ref.argpDot) / Math.abs(ref.argpDot)).toBeLessThan(0.15);
  });
});

describe('sphericalHarmonics: tesseral (C22/S22) is longitude-dependent', () => {
  // Build a degree-2 field with only the (2,2) tesseral. Its potential is
  //   U22 = (gm/r)(Re/r)^2 Pbar_{2,2}(sin phi) [Cbar22 cos2L + Sbar22 sin2L],
  // longitude-dependent by construction. The acceleration = +grad U (our sign of the
  // body-fixed acceleration), which we verify against a direct numerical gradient of
  // that exact scalar potential (an independent oracle, not the recurrence).
  const C22 = 1.5e-6;
  const S22 = -0.9e-6;
  const cbar = [[0], [0, 0], [0, 0, C22]];
  const sbar = [[0], [0, 0], [0, 0, S22]];
  const sh = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(IDENTITY) });

  // Normalized associated Legendre Pbar_{2,2}(sin phi) = sqrt(15)/2 * cos^2 phi.
  const potential = (r: Vector3): number => {
    const rmag = Math.hypot(r[0], r[1], r[2]);
    const sinPhi = r[2] / rmag;
    const cos2Phi = 1 - sinPhi * sinPhi;
    const lambda = Math.atan2(r[1], r[0]);
    const pbar22 = (Math.sqrt(15) / 2) * cos2Phi;
    return (
      (EARTH.gm / rmag) *
      (EARTH.re / rmag) ** 2 *
      pbar22 *
      (C22 * Math.cos(2 * lambda) + S22 * Math.sin(2 * lambda))
    );
  };

  it('matches the numerical gradient of the exact (2,2) potential', () => {
    const r: Vector3 = [6900, 1500, 800];
    const a = sh.acceleration({ et: 0, r, v: [0, 0, 0] });
    const grad = new Array<number>(3);
    for (let j = 0; j < 3; j++) {
      const h = 1e-2;
      const rp = [...r] as [number, number, number];
      const rm = [...r] as [number, number, number];
      rp[j] = r[j]! + h;
      rm[j] = r[j]! - h;
      grad[j] = (potential(rp) - potential(rm)) / (2 * h);
    }
    // The cannonball acceleration is +grad of the disturbing potential.
    for (let i = 0; i < 3; i++) expect(a[i]!).toBeCloseTo(grad[i]!, 12);
    // And it is genuinely longitude-dependent: rotating r by 90 deg about Z changes it.
    const rRot: Vector3 = [-r[1], r[0], r[2]];
    const aRot = sh.acceleration({ et: 0, r: rRot, v: [0, 0, 0] });
    const same = Math.abs(aRot[0] - a[0]) < 1e-15 && Math.abs(aRot[1] - a[1]) < 1e-15;
    expect(same).toBe(false);
  });
});

describe('sphericalHarmonics: rotation maps body-fixed back to inertial', () => {
  it('a 90 deg Z rotation moves the response by the inverse rotation', () => {
    const C22 = 2e-6;
    const cbar = [[0], [0, 0], [0, 0, C22]];
    const sbar = [[0], [0, 0], [0, 0, 0]];
    // rot = body-fixed -> inertial = Rz(90). Evaluating at inertial r equals evaluating
    // the identity field at the body-fixed r' = rot^T r.
    const rot: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const shRot = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(rot) });
    const shId = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(IDENTITY) });
    const r: Vector3 = [6900, 1500, 800];
    const aRot = shRot.acceleration({ et: 0, r, v: [0, 0, 0] });
    // Body-fixed position r' = rot^T r.
    const rBody: Vector3 = [r[1], -r[0], r[2]];
    const aBody = shId.acceleration({ et: 0, r: rBody, v: [0, 0, 0] });
    // a_inertial = rot * a_body.
    const expected: Vector3 = [-aBody[1], aBody[0], aBody[2]];
    for (let i = 0; i < 3; i++) expect(aRot[i]!).toBeCloseTo(expected[i]!, 14);
  });
});

describe('sphericalHarmonics: effective da/dr (FD fallback) matches a central difference', () => {
  it('the model FD da/dr equals a direct central difference of the term', () => {
    const cbar = [[0], [0, 0], [-EARTH.j2 / Math.sqrt(5), 0, 1.5e-6], [0, 0, 0, 0]];
    const sbar = [[0], [0, 0], [0, 0, -0.9e-6], [0, 0, 0, 0]];
    const sh = sphericalHarmonics({ body: EARTH, cbar, sbar, rotation: fixedRotation(IDENTITY) });
    const ctx: ForceContext = { et: 0, r: [7000, 1200, -400], v: [1, 7, 0.5] };
    const model = createForceModel([sh]);
    const summed = model.partials(ctx).dadr;
    const ref = fdDadr(sh, ctx);
    for (let i = 0; i < 9; i++) expect(summed[i]!).toBeCloseTo(ref[i]!, 6);
  });
});
