// The panel's pure product-to-form mappers: body-fixed positions to
// planetocentric lon/lat, and the row-major field to renderable cells with
// the NaN-is-unresolved convention carried through as null.

import { describe, expect, it } from 'vitest';
import type { GeoLayer, ScalarField } from '@bessel/compute';
import { fieldToCells, layerToLonLat } from './mappers.ts';

const layer = (positions: number[]): GeoLayer => ({
  label: 'track',
  frame: 'IAU_EARTH',
  form: 'polyline',
  positions: new Float64Array(positions),
});

describe('layerToLonLat', () => {
  it('maps axis-aligned positions to the expected planetocentric angles', () => {
    const { lon, lat } = layerToLonLat(layer([6371, 0, 0, 0, 6371, 0, 0, 0, 6371]));
    expect(lon[0]).toBeCloseTo(0, 12);
    expect(lat[0]).toBeCloseTo(0, 12);
    expect(lon[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(lat[1]).toBeCloseTo(0, 12);
    expect(lat[2]).toBeCloseTo(Math.PI / 2, 12);
  });

  it('is radius-invariant (planetocentric, not a projection)', () => {
    const near = layerToLonLat(layer([100, 100, 50]));
    const far = layerToLonLat(layer([1000, 1000, 500]));
    expect(near.lon[0]).toBeCloseTo(far.lon[0]!, 12);
    expect(near.lat[0]).toBeCloseTo(far.lat[0]!, 12);
  });
});

describe('fieldToCells', () => {
  const field: ScalarField = {
    name: 'visible',
    unit: 'count',
    body: 'EARTH',
    frame: 'IAU_EARTH',
    latMin: -1,
    latMax: 1,
    latCount: 2,
    lonMin: -2,
    lonMax: 2,
    lonCount: 3,
    values: new Float64Array([0, 1, 2, NaN, 4, 5]),
  };

  it('emits row-major cells and turns NaN into null (unresolved)', () => {
    const cells = fieldToCells(field);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ row: 0, col: 0, value: 0 });
    expect(cells[2]).toEqual({ row: 0, col: 2, value: 2 });
    expect(cells[3]).toEqual({ row: 1, col: 0, value: null });
    expect(cells[5]).toEqual({ row: 1, col: 2, value: 5 });
  });
});
