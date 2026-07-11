// Stop conditions, validated by propagating a two-body arc with the compiled terminal
// EventSpecs and checking the stop state against closed-form Kepler geometry. Reuses the
// #28 dense/event substrate (propagateCowellEx) directly. (STK_PARITY_SPEC §4.3.)

import { describe, it, expect } from 'vitest';
import { compileStops } from './stop.ts';
import { propagateCowellEx } from '../cowell.ts';
import { createForceModel } from '../force/model.ts';
import { pointMass } from '../force/point-mass.ts';
import type { CartesianState } from '@bessel/spice';
import type { StopCondition } from './segments.ts';

const MU = 398600.4418;
const RE = 6378.137;
// t=0 is apoapsis; a=6363.8, e~0.0998, period ~5053 s, periapsis radius ~5728.6 km.
const ECC: CartesianState = { position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 6.5, z: 3.0 } };
const fm = createForceModel([pointMass(MU)]);

function stopAt(stops: readonly StopCondition[], maxDuration: number): { t: number; name: string; r: number; rdotv: number } {
  const { specs } = compileStops(stops, 0, maxDuration, MU, RE);
  const grid = Float64Array.from({ length: 65 }, (_, k) => (k * maxDuration) / 64);
  const res = propagateCowellEx({ state: ECC, epoch: 0, etGrid: grid, forceModel: fm, tolerances: { rtol: 1e-12, atol: 1e-12 }, events: specs });
  expect(res.stopped).toBe(true);
  const hit = res.events[res.events.length - 1]!;
  const y = hit.y;
  return {
    t: res.tEnd,
    name: hit.name,
    r: Math.hypot(y[0]!, y[1]!, y[2]!),
    rdotv: y[0]! * y[3]! + y[1]! * y[4]! + y[2]! * y[5]!,
  };
}

describe('compileStops against analytic Kepler geometry', () => {
  it('stops at periapsis (min radius, r.v ~ 0, ~half period)', () => {
    const s = stopAt([{ type: 'Periapsis' }], 5100);
    expect(s.name).toBe('Periapsis');
    expect(s.r).toBeGreaterThan(5720);
    expect(s.r).toBeLessThan(5735);
    expect(Math.abs(s.rdotv)).toBeLessThan(1e-3);
    expect(s.t).toBeGreaterThan(2300);
    expect(s.t).toBeLessThan(2750);
  });

  it('stops at apoapsis (max radius near the start of the next revolution)', () => {
    const s = stopAt([{ type: 'Apoapsis' }], 5200);
    expect(s.name).toBe('Apoapsis');
    expect(s.r).toBeGreaterThan(6990); // a(1+e) ~ 6999
    expect(Math.abs(s.rdotv)).toBeLessThan(1e-3);
  });

  it('stops at a rising altitude crossing', () => {
    // Periapsis radius ~5728 (altitude ~ -650 km below RE, so use a radius above periapsis).
    const s = stopAt([{ type: 'Altitude', value: 400, crossing: 'rising' }], 5200);
    expect(s.name).toBe('Altitude');
    expect(s.r).toBeCloseTo(RE + 400, 3);
  });

  it('falls back to the duration backstop when no geometric stop fires', () => {
    const { specs, backstopIndex } = compileStops([{ type: 'Altitude', value: 100000, crossing: 'rising' }], 0, 1000, MU, RE);
    expect(specs[backstopIndex]!.name).toBe('backstop');
    const grid = Float64Array.from({ length: 11 }, (_, k) => k * 100);
    const res = propagateCowellEx({ state: ECC, epoch: 0, etGrid: grid, forceModel: fm, events: specs });
    expect(res.stopped).toBe(true);
    expect(res.events[res.events.length - 1]!.name).toBe('backstop');
    expect(res.tEnd).toBeCloseTo(1000, 3);
  });
});
