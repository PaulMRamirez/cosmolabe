// Oracle test for the terrain-masked line-of-sight constraint on the Cassini fixtures. The
// geometry is Cassini (-82) seen from Earth (399) with the Sun as the masking body, sampled in
// IAU_SUN: both endpoints sit at comparable, finite range from the Sun, so the chord's closest
// approach lands mid-segment (well inside the ray sampling), unlike a chord with one endpoint at
// effectively infinite range. Over this span the chord clears the Sun by ~16.3 to 16.8 million km,
// so a zero-height DEM admits the whole span. A constructed ridge that raises the Sun's surface
// above the chord's closest approach, over the sub-chord longitude band, blocks the LOS for the
// later epochs where the chord drops closest, so the ridge window is a strict subset of the flat
// window and excludes epochs the flat DEM admits. The access window is cross-checked epoch by
// epoch against an independent terrainMaskedLos call on the same body-fixed positions.
// (STK_PARITY_SPEC §4.12, ACC terrain-masked LOS.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { windowMeasure, windowContains } from '@bessel/timeline';
import { terrainMaskedLos, FLAT_DEM, type Dem, type Vec3 } from '@bessel/terrain';
import { computeAccess, TerrainMaskedLosConstraintError } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const OBSERVER = '-82'; // Cassini
const TARGET = '399'; // Earth
const BODY = 'SUN';
const FRAME = 'IAU_SUN';

describe('@bessel/access terrainLos constraint', () => {
  let spice: SpiceEngine;
  let t0: number;
  let t1: number;
  let bodyRadiusKm: number;

  // Cassini and Earth body-fixed positions (km) in IAU_SUN, relative to the Sun's center: the
  // exact pair the constraint feeds to terrainMaskedLos.
  const endpoints = async (et: number): Promise<{ obs: Vec3; tgt: Vec3 }> => {
    const obs = (await spice.spkpos(OBSERVER, et, FRAME, 'NONE', BODY)).position;
    const tgt = (await spice.spkpos(TARGET, et, FRAME, 'NONE', BODY)).position;
    return { obs, tgt };
  };

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    t0 = await spice.str2et('2004-07-01T00:00:00');
    t1 = await spice.str2et('2004-07-01T06:00:00');
    bodyRadiusKm = (await spice.bodvrd(BODY, 'RADII'))[0]!;
  });

  it('flat DEM clear window matches an independent per-epoch terrainMaskedLos series', async () => {
    const flat = await computeAccess(spice, {
      observer: OBSERVER, target: TARGET, span: [t0, t1], step: 300,
      constraints: [{ kind: 'terrainLos', body: BODY, bodyFrame: FRAME, dem: FLAT_DEM }],
    });
    // The chord clears the Sun by far more than its radius, so the flat DEM admits the whole span.
    expect(windowMeasure(flat)).toBeCloseTo(t1 - t0, 1);

    // Independent oracle: the boolean clear/blocked series agrees with windowContains everywhere.
    for (let i = 1; i < 30; i++) {
      const et = t0 + (i / 30) * (t1 - t0);
      const { obs, tgt } = await endpoints(et);
      expect(windowContains(flat, et)).toBe(terrainMaskedLos(obs, tgt, FLAT_DEM, bodyRadiusKm));
    }
  });

  it('a ridge raised between observer and target excludes epochs the flat DEM admits', async () => {
    const flat = await computeAccess(spice, {
      observer: OBSERVER, target: TARGET, span: [t0, t1], step: 300,
      constraints: [{ kind: 'terrainLos', body: BODY, bodyFrame: FRAME, dem: FLAT_DEM }],
    });

    // Body-fixed longitude of the chord's closest approach to the Sun center (the ridge's place).
    const { obs, tgt } = await endpoints((t0 + t1) / 2);
    const dx = tgt.x - obs.x, dy = tgt.y - obs.y, dz = tgt.z - obs.z;
    const u = -(obs.x * dx + obs.y * dy + obs.z * dz) / (dx * dx + dy * dy + dz * dz);
    const ridgeLon = Math.atan2(obs.y + dy * u, obs.x + dx * u);

    // A ridge whose surface top (16.5 million km) sits between the early (~16.8e6) and late
    // (~16.3e6) closest-approach radii, over a longitude band around the sub-chord point: it
    // clears the early epochs and blocks the later ones (a moving boundary).
    const ridgeTopKm = 16_500_000;
    const dLon = 0.3;
    const angDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const ridge: Dem = {
      heightAt: (lon) => (angDiff(lon, ridgeLon) < dLon ? (ridgeTopKm - bodyRadiusKm) * 1000 : 0),
    };

    const ridgeW = await computeAccess(spice, {
      observer: OBSERVER, target: TARGET, span: [t0, t1], step: 300,
      constraints: [{ kind: 'terrainLos', body: BODY, bodyFrame: FRAME, dem: ridge }],
    });

    // The ridge removes admitted time: a strict subset of the flat (whole-span) window.
    expect(windowMeasure(ridgeW)).toBeGreaterThan(0); // some access survives
    expect(windowMeasure(ridgeW)).toBeLessThan(windowMeasure(flat));

    // Every epoch the ridge window excludes but the flat window admits is one the independent
    // terrainMaskedLos confirms the ridge blocks and the flat DEM does not.
    let foundExcluded = false;
    for (let i = 1; i < 60; i++) {
      const et = t0 + (i / 60) * (t1 - t0);
      const flatHas = windowContains(flat, et);
      const ridgeHas = windowContains(ridgeW, et);
      if (flatHas && !ridgeHas) {
        const e = await endpoints(et);
        expect(terrainMaskedLos(e.obs, e.tgt, FLAT_DEM, bodyRadiusKm)).toBe(true);
        expect(terrainMaskedLos(e.obs, e.tgt, ridge, bodyRadiusKm)).toBe(false);
        foundExcluded = true;
      }
    }
    expect(foundExcluded).toBe(true);
  });

  it('fails loud with a typed error on a non-positive sample count', async () => {
    await expect(
      computeAccess(spice, {
        observer: OBSERVER, target: TARGET, span: [t0, t1], step: 300,
        constraints: [{ kind: 'terrainLos', body: BODY, bodyFrame: FRAME, dem: FLAT_DEM, samples: 1 }],
      }),
    ).rejects.toBeInstanceOf(TerrainMaskedLosConstraintError);
  });
});
