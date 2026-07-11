// Solar radiation pressure (cannonball + cylindrical shadow). Independent oracles:
//   (1) in full sunlight the acceleration points anti-sunward with the closed-form
//       magnitude P*(Cr*A/m)*(AU/d)^2 (computed by hand, in km/s^2).
//   (2) inside the cylindrical umbra the acceleration is exactly zero; just outside it
//       is nonzero (the shadow switch).
//   (3) the effective da/dr (model FD fallback) matches a central difference (evaluated
//       in sunlight where the field is smooth).
// References: Montenbruck & Gill section 3.4; Vallado section 8.6.4. (STK_PARITY_SPEC 4.2.)

import { describe, it, expect } from 'vitest';
import { createForceModel } from './force/model.ts';
import { srp, cylindricalShadow } from './force/srp.ts';
import type { ForceContext, ForceTerm, Vector3 } from './force/types.ts';

const EARTH_RE = 6378.137;
const AU_KM = 1.495978707e8;
const P_SUN = 4.56e-6; // N/m^2

const sunAt = (s: Vector3) => () => s;

describe('srp acceleration in sunlight', () => {
  const cr = 1.3;
  const area = 10; // m^2
  const mass = 500; // kg
  const sun: Vector3 = [AU_KM, 0, 0]; // Sun at +X, 1 AU
  const term = srp({ cr, area, mass, sunPosition: sunAt(sun), occultingRadius: EARTH_RE });

  it('points anti-sunward with the analytic magnitude', () => {
    // Satellite on the day side, near +X, so it is in full sunlight.
    const r: Vector3 = [7000, 0, 0];
    const a = term.acceleration({ et: 0, r, v: [0, 0, 0] });
    // Anti-sunward = -X.
    expect(a[0]).toBeLessThan(0);
    expect(a[1]).toBeCloseTo(0, 18);
    expect(a[2]).toBeCloseTo(0, 18);
    // Closed-form magnitude: P * Cr * (A/m) * (AU/d)^2, in km/s^2 (A/m in m^2/kg, *1e-3).
    const d = AU_KM - 7000;
    const expectedMag = P_SUN * cr * (area / mass) * 1e-3 * (AU_KM / d) ** 2;
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(expectedMag, 18);
  });
});

describe('cylindrical shadow', () => {
  const sun: Vector3 = [AU_KM, 0, 0];

  it('is lit on the sunward side', () => {
    expect(cylindricalShadow([7000, 0, 0], sun, EARTH_RE)).toBe(1);
  });

  it('is dark directly behind the Earth (within the shadow cylinder)', () => {
    // Anti-sunward (-X) and within Re of the axis.
    expect(cylindricalShadow([-7000, 100, 0], sun, EARTH_RE)).toBe(0);
  });

  it('is lit anti-sunward but outside the shadow cylinder', () => {
    // Anti-sunward but far off-axis (beyond Re): sunlight grazes past the Earth.
    expect(cylindricalShadow([-7000, EARTH_RE + 500, 0], sun, EARTH_RE)).toBe(1);
  });
});

describe('srp shadow switching', () => {
  const term = srp({ cr: 1.3, area: 10, mass: 500, sunPosition: sunAt([AU_KM, 0, 0]), occultingRadius: EARTH_RE });

  it('is exactly zero inside the umbra', () => {
    const a = term.acceleration({ et: 0, r: [-7000, 0, 0], v: [0, 0, 0] });
    expect(a).toEqual([0, 0, 0]);
  });

  it('is nonzero just outside the umbra', () => {
    const a = term.acceleration({ et: 0, r: [-7000, EARTH_RE + 500, 0], v: [0, 0, 0] });
    expect(Math.hypot(a[0], a[1], a[2])).toBeGreaterThan(0);
  });
});

describe('srp partials (effective da/dr)', () => {
  const term: ForceTerm = srp({ cr: 1.3, area: 10, mass: 500, sunPosition: sunAt([AU_KM, 0, 0]), occultingRadius: EARTH_RE });
  const ctx: ForceContext = { et: 0, r: [7000, 1200, -400], v: [1, 7, 0.5] };

  it('model FD da/dr matches a direct central difference (in sunlight)', () => {
    const model = createForceModel([term]);
    const summed = model.partials(ctx).dadr;
    const ref = new Array<number>(9);
    for (let j = 0; j < 3; j++) {
      const r = [ctx.r[0], ctx.r[1], ctx.r[2]];
      const h = Math.max(1, Math.abs(r[j]!)) * 1e-6;
      const rp = [...r] as [number, number, number];
      const rm = [...r] as [number, number, number];
      rp[j] = r[j]! + h;
      rm[j] = r[j]! - h;
      const ap = term.acceleration({ et: 0, r: rp, v: ctx.v });
      const am = term.acceleration({ et: 0, r: rm, v: ctx.v });
      for (let i = 0; i < 3; i++) ref[i * 3 + j] = (ap[i]! - am[i]!) / (2 * h);
    }
    for (let i = 0; i < 9; i++) expect(summed[i]!).toBeCloseTo(ref[i]!, 6);
  });
});
