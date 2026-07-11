// The Lambert porkchop sweep is a pure grid solve over @bessel/mission lambert. These tests
// assert the axis builder, that the sweep produces a full row-major grid, marks the minimum-
// delta-v node, carries a solved departure burn vector, records non-converging nodes as gaps,
// and fails loud on a malformed grid. (analysis-UX Phase 2.)

import { describe, it, expect } from 'vitest';
import { linspace, sweepPorkchop, type SampledState } from './porkchop.ts';

const MU_SUN = 1.32712440018e11;

/** A planar circular state at radius r (km) about a mu-body, phase angle theta (rad). */
function circular(r: number, theta: number, mu: number): SampledState {
  const v = Math.sqrt(mu / r);
  return {
    position: { x: r * Math.cos(theta), y: r * Math.sin(theta), z: 0 },
    velocity: { x: -v * Math.sin(theta), y: v * Math.cos(theta), z: 0 },
  };
}

describe('linspace', () => {
  it('builds a closed, evenly spaced, strictly increasing axis', () => {
    expect(linspace(0, 10, 3)).toEqual([0, 5, 10]);
  });

  it('fails loud on too few samples or a non-increasing range', () => {
    expect(() => linspace(0, 10, 1)).toThrow(/>= 2 samples/);
    expect(() => linspace(10, 0, 4)).toThrow(/must increase/);
    expect(() => linspace(Number.NaN, 10, 4)).toThrow(/non-finite/);
  });
});

describe('sweepPorkchop', () => {
  // A 3x3 grid: two departure epochs of a 1 AU body, arrivals on a 1.5 AU body.
  const departureEt = linspace(0, 86400, 3);
  const tofSec = linspace(150 * 86400, 300 * 86400, 3);
  const AU = 1.495978707e8;
  const departureStates: SampledState[] = departureEt.map((_e, i) =>
    circular(AU, (i * Math.PI) / 12, MU_SUN),
  );
  const arrivalStates: SampledState[][] = departureEt.map(() =>
    tofSec.map((_t, j) => circular(1.5 * AU, Math.PI / 4 + (j * Math.PI) / 12, MU_SUN)),
  );

  it('produces a full row-major grid with a marked minimum and a burn vector', () => {
    const r = sweepPorkchop({ departureEt, tofSec }, MU_SUN, departureStates, arrivalStates, 'Earth -> Mars');
    expect(r.nodes).toHaveLength(9);
    // Row-major over departure x TOF.
    expect(r.nodes[0]).toMatchObject({ departureIndex: 0, tofIndex: 0 });
    expect(r.nodes[8]).toMatchObject({ departureIndex: 2, tofIndex: 2 });
    expect(r.best).not.toBeNull();
    const best = r.best!;
    expect(best.deltaVKmS).toBe(r.minDeltaVKmS);
    expect(best.deltaVKmS).toBeGreaterThan(0);
    expect(r.maxDeltaVKmS).toBeGreaterThanOrEqual(r.minDeltaVKmS);
    // The marked node really is the smallest finite delta-v in the grid.
    const finite = r.nodes.map((n) => n.deltaVKmS).filter((v): v is number => v !== null);
    expect(best.deltaVKmS).toBe(Math.min(...finite));
    // The burn vector is v1 minus the departure body velocity at the best node.
    const dep = departureStates[best.departureIndex]!;
    expect(best.departureDeltaV.x).toBeCloseTo(best.departureVelocity.x - dep.velocity.x, 6);
    expect(best.departureDeltaV.y).toBeCloseTo(best.departureVelocity.y - dep.velocity.y, 6);
  });

  it('fires onProgress once per departure column (analysis-UX Phase 3 worker progress)', () => {
    const ticks: { done: number; total: number }[] = [];
    sweepPorkchop({ departureEt, tofSec }, MU_SUN, departureStates, arrivalStates, 'progress', {
      onProgress: (done, total) => ticks.push({ done, total }),
    });
    // One tick per departure epoch (3), advancing done from 1..3 with a fixed total of 3.
    expect(ticks).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it('records a non-converging node as a null-delta-v gap instead of aborting', () => {
    // A 180-degree transfer (arrival antiparallel to departure) is degenerate (A ~ 0): the
    // transfer plane is undefined, so lambert throws and the node is recorded as a gap.
    const badArrivals = arrivalStates.map((row, i) =>
      row.map((s, j) => {
        if (i === 1 && j === 1) {
          const dep = departureStates[1]!.position;
          return { position: { x: -dep.x, y: -dep.y, z: -dep.z }, velocity: s.velocity };
        }
        return s;
      }),
    );
    const r = sweepPorkchop({ departureEt, tofSec }, MU_SUN, departureStates, badArrivals, 'gap');
    const gap = r.nodes.find((n) => n.departureIndex === 1 && n.tofIndex === 1)!;
    expect(gap.deltaVKmS).toBeNull();
    // The rest of the grid still solves and a minimum is still marked.
    expect(r.best).not.toBeNull();
  });

  it('fails loud on a grid whose state matrices do not match the axes', () => {
    expect(() =>
      sweepPorkchop({ departureEt, tofSec }, MU_SUN, departureStates.slice(0, 2), arrivalStates, 'x'),
    ).toThrow(/departureStates length/);
    expect(() => sweepPorkchop({ departureEt, tofSec }, -1, departureStates, arrivalStates, 'x')).toThrow(
      /mu must be positive/,
    );
  });
});
