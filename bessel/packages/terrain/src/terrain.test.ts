// Terrain-masked LOS: a clear path over flat terrain is occluded once a tall ridge
// is placed between the endpoints, and the body curvature blocks an over-horizon
// path on its own. Pure. (STK_PARITY_SPEC §4.12.)

import { describe, it, expect } from 'vitest';
import {
  terrainMaskedLos,
  sampleRidgeDem,
  SAMPLE_RIDGE_DEM,
  DEFAULT_SAMPLE_RIDGE,
  FLAT_DEM,
  type Dem,
  type Vec3,
} from './index.ts';

const R = 6371;

// Two points at 200 km altitude, 0.1 rad of longitude apart, in the equatorial plane.
const A: Vec3 = { x: (R + 200) * Math.cos(0), y: (R + 200) * Math.sin(0), z: 0 };
const B: Vec3 = { x: (R + 200) * Math.cos(0.1), y: (R + 200) * Math.sin(0.1), z: 0 };

describe('terrainMaskedLos', () => {
  it('is clear between two elevated points over flat terrain', () => {
    expect(terrainMaskedLos(A, B, FLAT_DEM, R)).toBe(true);
  });

  it('is blocked once a tall ridge rises between the endpoints', () => {
    // A 300 km ridge near the chord midpoint (lon ~ 0.05) rises above the LOS.
    const ridge: Dem = { heightAt: (lon) => (Math.abs(lon - 0.05) < 0.02 ? 300_000 : 0) };
    expect(terrainMaskedLos(A, B, ridge, R)).toBe(false);
  });

  it('a low ridge below the LOS does not block it', () => {
    const lowRidge: Dem = { heightAt: (lon) => (Math.abs(lon - 0.05) < 0.02 ? 50_000 : 0) };
    expect(terrainMaskedLos(A, B, lowRidge, R)).toBe(true);
  });

  it('the body curvature blocks an over-horizon surface-to-surface path', () => {
    const s1: Vec3 = { x: R, y: 0, z: 0 };
    const s2: Vec3 = { x: R * Math.cos(2.5), y: R * Math.sin(2.5), z: 0 }; // far around the limb
    expect(terrainMaskedLos(s1, s2, FLAT_DEM, R)).toBe(false);
  });
});

describe('sampleRidgeDem (deterministic built-in sample DEM)', () => {
  const dem = sampleRidgeDem();

  it('is deterministic: the same lon/lat always yields the same height', () => {
    expect(dem.heightAt(0, 0)).toBe(dem.heightAt(0, 0));
    expect(SAMPLE_RIDGE_DEM.heightAt(0.03, 0.1)).toBe(sampleRidgeDem().heightAt(0.03, 0.1));
  });

  it('peaks at the crest (base + full ridge at the equator) and falls to the base outside the band', () => {
    const { baseM, ridgeHeightM, ridgeHalfWidthRad } = DEFAULT_SAMPLE_RIDGE;
    // Crest at lon=0, lat=0: base + full ridge height (band=1, latFactor=1).
    expect(dem.heightAt(0, 0)).toBeCloseTo(baseM + ridgeHeightM, 6);
    // Outside the half-width band: only the base remains.
    expect(dem.heightAt(ridgeHalfWidthRad + 0.01, 0)).toBeCloseTo(baseM, 6);
    expect(dem.heightAt(Math.PI, 0)).toBeCloseTo(baseM, 6);
  });

  it('tapers monotonically from the crest to the band edge', () => {
    const h0 = dem.heightAt(0, 0);
    const hMid = dem.heightAt(DEFAULT_SAMPLE_RIDGE.ridgeHalfWidthRad / 2, 0);
    const hEdge = dem.heightAt(DEFAULT_SAMPLE_RIDGE.ridgeHalfWidthRad, 0);
    expect(h0).toBeGreaterThan(hMid);
    expect(hMid).toBeGreaterThan(hEdge);
    expect(hEdge).toBeCloseTo(DEFAULT_SAMPLE_RIDGE.baseM, 6);
  });

  it('fades the ridge toward the poles (cos-lat taper) but never below the base', () => {
    const crest = dem.heightAt(0, 0);
    const high = dem.heightAt(0, 1.2); // far from the equator
    expect(high).toBeLessThan(crest);
    expect(high).toBeGreaterThanOrEqual(DEFAULT_SAMPLE_RIDGE.baseM);
    // At the pole the cos-lat factor is ~0, so only the base remains.
    expect(dem.heightAt(0, Math.PI / 2)).toBeCloseTo(DEFAULT_SAMPLE_RIDGE.baseM, 3);
  });

  it('wraps the ridge crest across the +-pi seam', () => {
    const ridgeAtPi = sampleRidgeDem({ ...DEFAULT_SAMPLE_RIDGE, ridgeLonRad: Math.PI });
    // -pi and +pi are the same meridian: both sit on the crest.
    expect(ridgeAtPi.heightAt(Math.PI, 0)).toBeCloseTo(ridgeAtPi.heightAt(-Math.PI, 0), 6);
    expect(ridgeAtPi.heightAt(Math.PI, 0)).toBeGreaterThan(DEFAULT_SAMPLE_RIDGE.baseM);
  });

  it('masks a line of sight that grazes the sample ridge but clears it away from the crest', () => {
    // A surface-grazing chord straddling the crest meridian is blocked by the ridge; the same chord
    // shifted well away from the crest (over the base-only terrain) is clear.
    const overCrest = terrainMaskedLos(
      { x: (R + 10) * Math.cos(-0.05), y: (R + 10) * Math.sin(-0.05), z: 0 },
      { x: (R + 10) * Math.cos(0.05), y: (R + 10) * Math.sin(0.05), z: 0 },
      dem,
      R,
    );
    const awayFromCrest = terrainMaskedLos(
      { x: (R + 10) * Math.cos(1.5), y: (R + 10) * Math.sin(1.5), z: 0 },
      { x: (R + 10) * Math.cos(1.6), y: (R + 10) * Math.sin(1.6), z: 0 },
      dem,
      R,
    );
    expect(overCrest).toBe(false);
    expect(awayFromCrest).toBe(true);
  });
});
