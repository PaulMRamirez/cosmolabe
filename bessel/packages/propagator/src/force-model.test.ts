// PRIMARY oracle: a point-mass + J2 numerical run must drift the node and periapsis
// at the rates the already-validated analytic secularRatesJ2 predicts (this pins the
// J2 acceleration magnitude AND sign with no external fixture). Plus: J2=0 collapses
// to two-body, and the integrated arc publishes to an SPK that spkezr reproduces.
// (STK_PARITY_SPEC §4.2.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type CartesianState, type SpiceEngine } from '@bessel/spice';
import { propagateCowell } from './cowell.ts';
import { publishEphemeris, secularRatesJ2, type EphemerisTable } from './elements.ts';
import { createForceModel } from './force/model.ts';
import { pointMass } from './force/point-mass.ts';
import { zonalHarmonics } from './force/zonal.ts';
import { thirdBody } from './force/third-body.ts';
import type { ForceContext, ForceTerm } from './force/types.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const EARTH = { gm: 398600.4418, j2: 1.08262668e-3, re: 6378.137 };

/** Unwrap a sequence of angles (rad) into a continuous run. */
function unwrap(a: number[]): number[] {
  const out = [a[0]!];
  for (let i = 1; i < a.length; i++) {
    let d = a[i]! - a[i - 1]!;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(out[i - 1]! + d);
  }
  return out;
}

/** Least-squares slope of y vs t. */
function slope(t: number[], y: number[]): number {
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
}

const row = (t: EphemerisTable, k: number): CartesianState => ({
  position: { x: t.x[k]!, y: t.y[k]!, z: t.z[k]! },
  velocity: { x: t.vx[k]!, y: t.vy[k]!, z: t.vz[k]! },
});

describe('Cowell + J2 vs secularRatesJ2', () => {
  let spice: SpiceEngine;
  const a = 6778;
  // A moderate eccentricity keeps the argument of periapsis well-conditioned (it is
  // ill-defined as e -> 0, which makes its osculating value too noisy to fit).
  const e = 0.05;
  const i = (51.6 * Math.PI) / 180;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    await spice.furnsh('naif0012.tls', fixture('naif0012.tls'));
  });

  async function elementSeries(j2: number): Promise<{ t: number[]; raan: number[]; argp: number[] }> {
    const el0 = { rp: a * (1 - e), ecc: e, inc: i, lnode: 0.7, argp: 0.5, m0: 0, t0: 0, mu: EARTH.gm };
    const s0 = await spice.conics(el0, 0);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / EARTH.gm);
    const perOrbit = 20;
    const orbits = 15;
    const grid = Float64Array.from({ length: perOrbit * orbits + 1 }, (_, k) => (k * period) / perOrbit);
    const fm = createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2 })]);
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
    return { t, raan, argp };
  }

  it('drifts the node and periapsis at the analytic secular rates', async () => {
    const { t, raan, argp } = await elementSeries(EARTH.j2);
    const raanDot = slope(t, unwrap(raan));
    const argpDot = slope(t, unwrap(argp));
    const ref = secularRatesJ2(a, e, i, EARTH);
    // Node regresses (negative) for a prograde orbit; periapsis advances below the
    // critical inclination. Magnitudes within ~10-15% (osculating-to-mean scatter).
    expect(raanDot).toBeLessThan(0);
    expect(Math.abs(raanDot - ref.raanDot) / Math.abs(ref.raanDot)).toBeLessThan(0.1);
    expect(argpDot).toBeGreaterThan(0);
    expect(Math.abs(argpDot - ref.argpDot) / Math.abs(ref.argpDot)).toBeLessThan(0.15);
  });

  it('collapses to two-body (no node drift) when J2 = 0', async () => {
    const { t, raan } = await elementSeries(0);
    expect(Math.abs(slope(t, unwrap(raan)))).toBeLessThan(1e-10);
  });

  it('publishes the integrated arc to an SPK that spkezr reproduces', async () => {
    const s0: CartesianState = {
      position: { x: 6878, y: 0, z: 0 },
      velocity: { x: 0, y: 6.0, z: 4.6 },
    };
    const grid = Float64Array.from({ length: 31 }, (_, k) => k * 120);
    const fm = createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2: EARTH.j2 })]);
    const table = propagateCowell({ state: s0, epoch: 0, etGrid: grid, forceModel: fm });
    const bodyId = -987001;
    await publishEphemeris(spice, table, { name: 'hpop.bsp', body: bodyId, center: 399, degree: 7 });
    const mid = grid[15]!;
    const got = await spice.spkezr(String(bodyId), mid, 'J2000', 'NONE', '399');
    expect(got.position.x).toBeCloseTo(table.x[15]!, 3);
    expect(got.position.y).toBeCloseTo(table.y[15]!, 3);
    expect(got.position.z).toBeCloseTo(table.z[15]!, 3);
  });
});

describe('Force-model acceleration partials (da/dr)', () => {
  // An independent central-difference of a term's acceleration, the reference the
  // analytic partials() must reproduce (and the FD fallback is checked against itself).
  const fdRef = (term: ForceTerm, ctx: ForceContext): number[] => {
    const dadr = new Array<number>(9);
    for (let j = 0; j < 3; j++) {
      const r = [ctx.r[0], ctx.r[1], ctx.r[2]];
      const h = Math.max(1, Math.abs(r[j]!)) * 1e-6;
      const rp = [...r] as [number, number, number];
      const rm = [...r] as [number, number, number];
      rp[j] = r[j]! + h;
      rm[j] = r[j]! - h;
      const ap = term.acceleration({ et: ctx.et, r: rp, v: ctx.v });
      const am = term.acceleration({ et: ctx.et, r: rm, v: ctx.v });
      for (let i = 0; i < 3; i++) dadr[i * 3 + j] = (ap[i]! - am[i]!) / (2 * h);
    }
    return dadr;
  };
  const ctx: ForceContext = { et: 0, r: [7000, 1200, -400], v: [1, 7, 0.5] };

  it('point-mass analytic da/dr matches a finite-difference reference', () => {
    const term = pointMass(EARTH.gm);
    const a = term.partials!(ctx).dadr;
    const ref = fdRef(term, ctx);
    for (let i = 0; i < 9; i++) expect(a[i]!).toBeCloseTo(ref[i]!, 9);
  });

  it('third-body analytic da/dr matches a finite-difference reference', () => {
    const sun = thirdBody('SUN', 1.327e11, () => [1.4e8, 3e7, -2e7]);
    const a = sun.partials!(ctx).dadr;
    const ref = fdRef(sun, ctx);
    for (let i = 0; i < 9; i++) expect(a[i]!).toBeCloseTo(ref[i]!, 12);
  });

  it('the model sums each term da/dr and falls back to FD for the zonal term', () => {
    const pm = pointMass(EARTH.gm);
    const zonal = zonalHarmonics(EARTH, { j2: EARTH.j2 });
    const model = createForceModel([pm, zonal]);
    const summed = model.partials(ctx).dadr;
    const expected = new Array<number>(9).fill(0);
    const pmRef = fdRef(pm, ctx);
    const zRef = fdRef(zonal, ctx);
    for (let i = 0; i < 9; i++) expected[i] = pmRef[i]! + zRef[i]!;
    // Analytic point-mass + FD zonal vs an independent FD of each; loose (FD vs FD).
    for (let i = 0; i < 9; i++) expect(summed[i]!).toBeCloseTo(expected[i]!, 6);
  });

  it('da/dr is symmetric for a conservative (gravity-only) model', () => {
    // d(-grad U)/dr is the negative Hessian of a scalar potential, hence symmetric.
    const model = createForceModel([pointMass(EARTH.gm), zonalHarmonics(EARTH, { j2: EARTH.j2, j3: 2.5e-6 })]);
    const m = model.partials(ctx).dadr;
    expect(m[1]!).toBeCloseTo(m[3]!, 6); // (0,1) vs (1,0)
    expect(m[2]!).toBeCloseTo(m[6]!, 6); // (0,2) vs (2,0)
    expect(m[5]!).toBeCloseTo(m[7]!, 6); // (1,2) vs (2,1)
  });
});
