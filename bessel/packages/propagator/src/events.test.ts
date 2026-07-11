// Event detection on the dense solution, validated against closed-form switching
// functions: g = r.v is zero exactly at an apsis (rising = periapsis), and g = z is
// zero at a node crossing. Direction filtering, the earliest-root ordering, terminal
// truncation, and the empty (no-event) case are all checked. (STK_PARITY_SPEC §4.2.)

import { describe, it, expect } from 'vitest';
import { integrateDense } from './dense.ts';
import { propagateCowellEx } from './cowell.ts';
import type { EventSpec } from './events.ts';
import { createForceModel } from './force/model.ts';
import { pointMass } from './force/point-mass.ts';
import type { CartesianState } from '@bessel/spice';
import type { Rhs } from './integrator.ts';

const EARTH = { gm: 398600.4418 };
// Eccentric orbit; t=0 is apoapsis (r.v = 0, v below circular), periapsis ~half a period later.
const ECCENTRIC: CartesianState = {
  position: { x: 7000, y: 0, z: 0 },
  velocity: { x: 0, y: 6.5, z: 3.0 },
};
const y0 = Float64Array.of(7000, 0, 0, 0, 6.5, 3.0);

const pointMassRhs = (gm: number): Rhs => {
  const fm = createForceModel([pointMass(gm)]);
  return (t, y, dy) => {
    const a = fm.acceleration({ et: t, r: [y[0]!, y[1]!, y[2]!], v: [y[3]!, y[4]!, y[5]!] });
    dy[0] = y[3]!;
    dy[1] = y[4]!;
    dy[2] = y[5]!;
    dy[3] = a[0];
    dy[4] = a[1];
    dy[5] = a[2];
  };
};

const rDotV: EventSpec = {
  name: 'apsis',
  g: (_t, y) => y[0]! * y[3]! + y[1]! * y[4]! + y[2]! * y[5]!,
};

describe('Event detection on the dense solution', () => {
  it('locates periapsis as the rising r.v crossing (min radius there)', () => {
    const { events, solution } = integrateDense(pointMassRhs(EARTH.gm), y0, 0, 5100, {
      rtol: 1e-12,
      atol: 1e-12,
      events: [{ ...rDotV, direction: 1 }],
    });
    expect(events.length).toBe(1); // periapsis only (apoapsis is a falling crossing)
    const peri = events[0]!;
    expect(peri.direction).toBe(1);
    const r = Math.hypot(peri.y[0]!, peri.y[1]!, peri.y[2]!);
    // Closed-form periapsis radius a(1-e) for this state is ~5728.6 km.
    expect(r).toBeGreaterThan(5720);
    expect(r).toBeLessThan(5735);
    // r.v is genuinely zero at the located root.
    const g = peri.y[0]! * peri.y[3]! + peri.y[1]! * peri.y[4]! + peri.y[2]! * peri.y[5]!;
    expect(Math.abs(g)).toBeLessThan(1e-3);
    // It is a true minimum: the interpolated radius just before/after is larger.
    const rAt = (t: number): number => {
      const s = solution.interpolate(t);
      return Math.hypot(s[0]!, s[1]!, s[2]!);
    };
    expect(rAt(peri.t - 30)).toBeGreaterThan(r);
    expect(rAt(peri.t + 30)).toBeGreaterThan(r);
  });

  it('finds both apsides with direction 0 and orders them by epoch', () => {
    const { events } = integrateDense(pointMassRhs(EARTH.gm), y0, 0, 5200, {
      rtol: 1e-12,
      atol: 1e-12,
      events: [rDotV], // direction 0 = either way
    });
    expect(events.length).toBe(2); // periapsis (rising) then apoapsis (falling)
    expect(events[0]!.t).toBeLessThan(events[1]!.t);
    expect(events[0]!.direction).toBe(1);
    expect(events[1]!.direction).toBe(-1);
    const r0 = Math.hypot(events[0]!.y[0]!, events[0]!.y[1]!, events[0]!.y[2]!);
    const r1 = Math.hypot(events[1]!.y[0]!, events[1]!.y[1]!, events[1]!.y[2]!);
    expect(r0).toBeLessThan(r1); // periapsis radius < apoapsis radius
  });

  it('locates the descending node as a falling z crossing (z ~ 0 there)', () => {
    const node: EventSpec = { name: 'descNode', g: (_t, y) => y[2]!, direction: -1 };
    const { events } = integrateDense(pointMassRhs(EARTH.gm), y0, 0, 5200, {
      rtol: 1e-12,
      atol: 1e-12,
      events: [node],
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.direction).toBe(-1);
      expect(Math.abs(e.y[2]!)).toBeLessThan(1e-3); // z ~ 0
    }
  });

  it('returns no hits when the switching function never crosses', () => {
    const never: EventSpec = { name: 'never', g: (_t, y) => Math.hypot(y[0]!, y[1]!, y[2]!) + 1000 };
    const { events } = integrateDense(pointMassRhs(EARTH.gm), y0, 0, 5200, { events: [never] });
    expect(events.length).toBe(0);
  });
});

describe('Terminal events truncate the arc (propagateCowellEx)', () => {
  it('stops at the first periapsis and shortens the table', () => {
    const grid = Float64Array.from({ length: 52 }, (_, k) => k * 100); // 0..5100 s
    const res = propagateCowellEx({
      state: ECCENTRIC,
      epoch: 0,
      etGrid: grid,
      forceModel: createForceModel([pointMass(EARTH.gm)]),
      tolerances: { rtol: 1e-12, atol: 1e-12 },
      events: [{ ...rDotV, direction: 1, terminal: true }],
    });
    expect(res.stopped).toBe(true);
    expect(res.events.length).toBe(1);
    expect(res.tEnd).toBeCloseTo(res.events[0]!.t, 6);
    // Table covers only grid epochs up to the stop, not the full 52.
    expect(res.table.et.length).toBeLessThan(grid.length);
    expect(res.table.et[res.table.et.length - 1]!).toBeLessThanOrEqual(res.tEnd + 1e-9);
    // The stop is near the closed-form half-period (~2526 s).
    expect(res.tEnd).toBeGreaterThan(2300);
    expect(res.tEnd).toBeLessThan(2750);
  });

  it('emits no grid sample past a terminal-event tEnd (clamps to tEnd, not solution.tf)', () => {
    // A terminal event at exactly t = 1250 s. The grid carries an epoch (1300) that lies between
    // tEnd and the end of the segment that bracketed the root: with the old solution.tf filter it
    // would emit a physically-stale state past the stop. Every emitted epoch must be <= tEnd.
    const tStop = 1250;
    const grid = Float64Array.from({ length: 52 }, (_, k) => k * 50); // 0..2550 s, includes 1300
    const res = propagateCowellEx({
      state: ECCENTRIC,
      epoch: 0,
      etGrid: grid,
      forceModel: createForceModel([pointMass(EARTH.gm)]),
      tolerances: { rtol: 1e-12, atol: 1e-12 },
      events: [{ name: 'fixedStop', g: (t) => t - tStop, direction: 1, terminal: true }],
    });
    expect(res.stopped).toBe(true);
    expect(res.tEnd).toBeCloseTo(tStop, 4);
    for (const t of res.table.et) {
      expect(t).toBeLessThanOrEqual(res.tEnd + 1e-9);
    }
    // The first grid epoch strictly past the stop (1300) must NOT appear in the table.
    expect(Array.from(res.table.et).some((t) => t > tStop + 1e-9)).toBe(false);
  });
});
