// Atmospheric drag. Independent oracles (not circular):
//   (1) the acceleration opposes v_rel and its magnitude equals the closed form
//       0.5*(Cd*A/m)*rho*|v_rel|^2 (computed by hand, not from the term).
//   (2) the exponential atmosphere returns the documented rho0 at a band base and the
//       e-folding value one scale-height up.
//   (3) over a propagated low orbit the specific energy (hence the semi-major axis)
//       decays monotonically (drag removes energy).
//   (4) the effective da/dr (model FD fallback) matches a central difference, and the
//       analytic da/dv matches a central difference in v.
// References: Montenbruck & Gill section 3.5; Vallado section 8.6.2. (STK_PARITY_SPEC 4.2.)

import { describe, it, expect } from 'vitest';
import { propagateCowell } from './cowell.ts';
import { createForceModel } from './force/model.ts';
import { pointMass } from './force/point-mass.ts';
import { drag, exponentialAtmosphere, type DensityModel } from './force/drag.ts';
import type { ForceContext, ForceTerm, Vector3 } from './force/types.ts';

const EARTH = { gm: 398600.4418, re: 6378.137 };
const EARTH_OMEGA = 7.2921159e-5;

/** A constant-density atmosphere isolates the drag algebra from the altitude model. */
const constantDensity = (rho: number): DensityModel => ({ density: () => rho });

const fdMat = (
  accel: (ctx: ForceContext) => Vector3,
  ctx: ForceContext,
  axis: 'r' | 'v',
): number[] => {
  const out = new Array<number>(9);
  const base = axis === 'r' ? [ctx.r[0], ctx.r[1], ctx.r[2]] : [ctx.v[0], ctx.v[1], ctx.v[2]];
  for (let j = 0; j < 3; j++) {
    const h = Math.max(1, Math.abs(base[j]!)) * 1e-6;
    const plus = [...base] as [number, number, number];
    const minus = [...base] as [number, number, number];
    plus[j] = base[j]! + h;
    minus[j] = base[j]! - h;
    const ap = accel(axis === 'r' ? { et: ctx.et, r: plus, v: ctx.v } : { et: ctx.et, r: ctx.r, v: plus });
    const am = accel(axis === 'r' ? { et: ctx.et, r: minus, v: ctx.v } : { et: ctx.et, r: ctx.r, v: minus });
    for (let i = 0; i < 3; i++) out[i * 3 + j] = (ap[i]! - am[i]!) / (2 * h);
  }
  return out;
};

describe('drag acceleration', () => {
  const cd = 2.2;
  const area = 5; // m^2
  const mass = 500; // kg
  const rho = 1e-2; // kg/km^3 (a generous LEO value)
  const term = drag({ cd, area, mass, atmosphere: constantDensity(rho), omega: [0, 0, 0] });

  it('opposes v_rel with the closed-form magnitude', () => {
    const ctx: ForceContext = { et: 0, r: [6878, 0, 0], v: [0, 7.6, 0] };
    const a = term.acceleration(ctx);
    // With omega = 0, v_rel = v = [0, 7.6, 0].
    const vmag = 7.6;
    const bc = (cd * area) / mass * 1e-6; // km^2/kg
    const expectedMag = 0.5 * bc * rho * vmag * vmag;
    // Direction: anti-velocity.
    expect(a[0]).toBeCloseTo(0, 15);
    expect(a[1]).toBeLessThan(0);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(expectedMag, 15);
  });

  it('subtracts the co-rotating atmosphere (omega x r)', () => {
    const withRot = drag({ cd, area, mass, atmosphere: constantDensity(rho) });
    // At [r,0,0] with v along +y, omega x r = [0, omega*r, 0], so v_rel_y = v_y - omega*r.
    const r = 6878;
    const ctx: ForceContext = { et: 0, r: [r, 0, 0], v: [0, 7.6, 0] };
    const a = withRot.acceleration(ctx);
    const vrelY = 7.6 - EARTH_OMEGA * r;
    const bc = (cd * area) / mass * 1e-6;
    const expectedMag = 0.5 * bc * rho * Math.abs(vrelY) * Math.abs(vrelY);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(expectedMag, 15);
    expect(Math.sign(a[1])).toBe(-Math.sign(vrelY));
  });
});

describe('exponentialAtmosphere density model', () => {
  const atm = exponentialAtmosphere({ re: EARTH.re });

  it('returns the documented base density at a band base altitude', () => {
    // The 400 km band base density is 3.725e-12 kg/m^3 = 3.725e-3 kg/km^3.
    const r: Vector3 = [EARTH.re + 400, 0, 0];
    const rho = atm.density(r);
    expect(rho).toBeCloseTo(3.725e-12 * 1e9, 9);
  });

  it('falls by 1/e one scale height above the band base', () => {
    // 500 km band: rho0 = 6.967e-13 kg/m^3, H = 63.822 km, width 100 km so h0 + H
    // (563.8 km) stays inside the band (no band switch).
    const H = 63.822;
    const r: Vector3 = [EARTH.re + 500 + H, 0, 0];
    const rho = atm.density(r);
    const expected = 6.967e-13 * Math.exp(-1) * 1e9;
    expect(rho).toBeCloseTo(expected, 9);
  });

  it('density decreases monotonically with altitude across bands', () => {
    let prev = Infinity;
    for (let h = 200; h <= 1000; h += 50) {
      const rho = atm.density([EARTH.re + h, 0, 0]);
      expect(rho).toBeLessThan(prev);
      prev = rho;
    }
  });
});

describe('drag decays a low orbit (energy monotonically decreases)', () => {
  it('the specific orbital energy strictly decreases over the arc', () => {
    // A 250 km circular orbit, exaggerated ballistic coefficient so a short arc shows
    // clear decay. Specific energy eps = v^2/2 - mu/r must fall monotonically.
    const alt = 250;
    const r0 = EARTH.re + alt;
    const vc = Math.sqrt(EARTH.gm / r0);
    const s0 = { position: { x: r0, y: 0, z: 0 }, velocity: { x: 0, y: vc, z: 0 } };
    const atm = exponentialAtmosphere({ re: EARTH.re });
    const dragTerm = drag({ cd: 2.2, area: 20, mass: 100, atmosphere: atm });
    const fm = createForceModel([pointMass(EARTH.gm), dragTerm]);
    const period = 2 * Math.PI * Math.sqrt(r0 ** 3 / EARTH.gm);
    const grid = Float64Array.from({ length: 41 }, (_, k) => (k * period) / 8);
    const table = propagateCowell({ state: s0, epoch: 0, etGrid: grid, forceModel: fm });
    let prev = Infinity;
    for (let k = 0; k < grid.length; k++) {
      const r = Math.hypot(table.x[k]!, table.y[k]!, table.z[k]!);
      const v2 = table.vx[k]! ** 2 + table.vy[k]! ** 2 + table.vz[k]! ** 2;
      const eps = v2 / 2 - EARTH.gm / r;
      expect(eps).toBeLessThan(prev);
      prev = eps;
    }
  });
});

describe('drag partials', () => {
  const term: ForceTerm = drag({
    cd: 2.2,
    area: 5,
    mass: 500,
    atmosphere: exponentialAtmosphere({ re: EARTH.re }),
  });
  const ctx: ForceContext = { et: 0, r: [6878, 100, -50], v: [0.3, 7.6, 0.1] };

  it('analytic da/dv matches a central difference in v', () => {
    const p = term.partials!(ctx);
    const ref = fdMat(term.acceleration, ctx, 'v');
    for (let i = 0; i < 9; i++) expect(p.dadv![i]!).toBeCloseTo(ref[i]!, 9);
  });

  it('effective da/dr matches a central difference in r', () => {
    const p = term.partials!(ctx);
    const ref = fdMat(term.acceleration, ctx, 'r');
    for (let i = 0; i < 9; i++) expect(p.dadr[i]!).toBeCloseTo(ref[i]!, 6);
  });
});
