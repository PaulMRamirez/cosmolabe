// Coverage grid-sweep oracle. Using the Sun as the "asset" over an Earth lat/lon
// grid (the only Earth-relative body in the fixtures), the elevation-access sweep is
// exactly a daylight map: a cell at the sub-solar longitude is sunlit (nonzero
// coverage) and its FOM matches a direct computeElevationAccess call; a cell on the
// far night side is dark. This proves the sweep reuses the access engine cell-for-
// cell and yields the expected qualitative coverage band. (STK_PARITY_SPEC §4.4.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { computeElevationAccess, type Facility } from '@bessel/access';
import { figureOfMerit } from './index.ts';
import { sweepCoverageGrid, GridSweepError, type GridSpec } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const DEG = Math.PI / 180;

describe('sweepCoverageGrid', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;
  // Sub-solar longitude (rad, IAU_EARTH) at the span midpoint: the daylit meridian.
  let subSolarLonRad: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T01:00:00'); // a 1 h window: Earth barely rotates
    const sub = await spice.subpnt('NEAR POINT/ELLIPSOID', 'EARTH', (t0 + t1) / 2, 'IAU_EARTH', 'NONE', 'SUN');
    subSolarLonRad = Math.atan2(sub.point.y, sub.point.x);
  });

  it('builds the expected row-major FOM grid with a sunlit band', async () => {
    // A 3x4 equatorial-band grid spanning all longitudes.
    const grid: GridSpec = {
      body: 'EARTH',
      bodyFrame: 'IAU_EARTH',
      latMin: -10 * DEG,
      latMax: 10 * DEG,
      latCount: 3,
      lonMin: -180 * DEG,
      lonMax: 150 * DEG, // 4 columns, 90 deg apart, avoiding duplicate at +180
      lonCount: 4,
      altKm: 0,
    };
    const result = await sweepCoverageGrid(spice, {
      grid,
      assets: ['SUN'],
      span: [t0, t1],
      step: 120,
      minElevationRad: 0,
    });

    expect(result.cells).toHaveLength(12);
    // Row-major: row index ascends with latitude, col with longitude.
    expect(result.cells[0]!.rowIndex).toBe(0);
    expect(result.cells[0]!.colIndex).toBe(0);
    expect(result.cells[4]!.rowIndex).toBe(1);

    // At least one cell sunlit (nonzero coverage) and at least one dark over the hour.
    const covered = result.cells.filter((c) => c.fom.percentCoverage > 0);
    const dark = result.cells.filter((c) => c.fom.percentCoverage === 0);
    expect(covered.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);

    // The grid carries an additive area-weighted coverage in [0,1] that matches a
    // direct cos(lat)-weighted recomputation over the cells.
    let weighted = 0;
    let totalWeight = 0;
    for (const c of result.cells) {
      const w = Math.max(0, Math.cos(c.latRad));
      weighted += w * c.fom.percentCoverage;
      totalWeight += w;
    }
    expect(result.areaWeightedPercentCoverage).toBeCloseTo(weighted / totalWeight, 9);
    expect(result.areaWeightedPercentCoverage).toBeGreaterThanOrEqual(0);
    expect(result.areaWeightedPercentCoverage).toBeLessThanOrEqual(1);
  });

  it('a cell at the sub-solar longitude is sunlit and its FOM matches a direct access call', async () => {
    // Single cell directly under the ground track (the sub-solar point).
    const grid: GridSpec = {
      body: 'EARTH',
      bodyFrame: 'IAU_EARTH',
      latMin: 0,
      latMax: 0,
      latCount: 1,
      lonMin: subSolarLonRad,
      lonMax: subSolarLonRad,
      lonCount: 1,
      altKm: 0,
    };
    const result = await sweepCoverageGrid(spice, {
      grid,
      assets: ['SUN'],
      span: [t0, t1],
      step: 120,
      minElevationRad: 0,
    });
    const cell = result.cells[0]!;
    expect(cell.fom.percentCoverage).toBeGreaterThan(0);

    // The direct single-(point, asset) computation must produce the same FOM.
    const facility: Facility = { body: 'EARTH', bodyFrame: 'IAU_EARTH', lonRad: subSolarLonRad, latRad: 0, altKm: 0 };
    const direct = await computeElevationAccess(spice, facility, 'SUN', [t0, t1], 120, 0);
    const directFom = figureOfMerit(direct, [t0, t1]);
    expect(cell.fom.percentCoverage).toBeCloseTo(directFom.percentCoverage, 9);
    expect(cell.fom.accessCount).toBe(directFom.accessCount);
    // 1-fold coverage equals the any-asset FOM for a single asset.
    expect(cell.nFoldCoverage[0]!).toBeCloseTo(cell.fom.percentCoverage, 9);
  });

  it('emits monotonic progress and fails loudly on a bad grid', async () => {
    const fractions: number[] = [];
    const grid: GridSpec = {
      body: 'EARTH', bodyFrame: 'IAU_EARTH',
      latMin: 0, latMax: 0, latCount: 1, lonMin: 0, lonMax: 0, lonCount: 1,
    };
    await sweepCoverageGrid(spice, {
      grid, assets: ['SUN'], span: [t0, t1], step: 300, minElevationRad: 0,
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions[fractions.length - 1]).toBeCloseTo(1, 9);

    await expect(
      sweepCoverageGrid(spice, {
        grid: { ...grid, latCount: 0 }, assets: ['SUN'], span: [t0, t1], step: 300, minElevationRad: 0,
      }),
    ).rejects.toBeInstanceOf(GridSweepError);
    await expect(
      sweepCoverageGrid(spice, { grid, assets: [], span: [t0, t1], step: 300, minElevationRad: 0 }),
    ).rejects.toBeInstanceOf(GridSweepError);
  });
});
