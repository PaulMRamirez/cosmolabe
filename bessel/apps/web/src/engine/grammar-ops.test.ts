// Unit tests for the grammar demo's pure product-to-form mappers: the field
// drape spec (NaN cells render as zero until resolved), the body-fixed to
// inertial polyline rotation, and the provenance view the legend chip shows.

import { describe, it, expect } from 'vitest';
import type { AnalysisProduct, ScalarField } from '@bessel/compute';
import {
  fieldResolvedCells,
  fieldToOverlaySpec,
  layerToScenePoints,
  provenanceView,
} from './grammar-ops.ts';

const FIELD: ScalarField = {
  name: 'percentCoverage',
  unit: 'percent',
  body: 'EARTH',
  frame: 'IAU_EARTH',
  latMin: -0.5,
  latMax: 0.5,
  latCount: 2,
  lonMin: 0,
  lonMax: 1,
  lonCount: 2,
  values: Float64Array.from([0, 50, 200, Number.NaN]),
};

describe('grammar demo mappers', () => {
  it('maps a field to the overlay spec with NaN as zero and values clamped', () => {
    const spec = fieldToOverlaySpec(FIELD, 'Earth', [6378.137, 6378.137, 6356.752]);
    expect(spec.anchorBody).toBe('Earth');
    expect(spec.bodyRadiusKm).toBe(6378.137);
    expect(spec.polarRadiusKm).toBe(6356.752);
    expect(spec.latCount).toBe(2);
    expect(spec.cells.length).toBe(4);
    expect(spec.cells.map((c) => c.fom)).toEqual([0, 0.5, 1, 0]); // clamp 200 to 1, NaN to 0
    expect(spec.cells[0]!.latRad).toBe(-0.5);
    expect(spec.cells[3]!.latRad).toBe(0.5);
    expect(spec.cells[3]!.lonRad).toBe(1);
  });

  it('counts resolved cells for the legend chip', () => {
    expect(fieldResolvedCells(FIELD)).toBe(3);
  });

  it('rotates body-fixed polyline vertices into the scene frame', () => {
    // Rotation by +90 degrees about z (row-major, body-fixed to inertial).
    const rot90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const points = layerToScenePoints(
      { label: 't', frame: 'IAU_X', form: 'polyline', positions: Float64Array.from([1, 0, 0, 0, 2, 0]) },
      rot90,
    );
    expect(points[0]![0]).toBeCloseTo(0, 12);
    expect(points[0]![1]).toBeCloseTo(1, 12);
    expect(points[1]![0]).toBeCloseTo(-2, 12);
    expect(points[1]![1]).toBeCloseTo(0, 12);
  });

  it('projects the provenance block for the legend chip popover', () => {
    const product: AnalysisProduct = {
      product: { kind: 'intervals', sets: [] },
      provenance: {
        engine: 'access',
        version: '0.0.0',
        kernels: { setHash: 'h'.repeat(64), names: [] },
        frame: 'J2000',
        correction: 'NONE',
        authority: 'exploratory',
        computedAt: '2026-07-11T00:00:00.000Z',
        jobId: 'access-1',
      },
      units: {},
    };
    expect(provenanceView(product)).toEqual({
      engine: 'access',
      version: '0.0.0',
      setHash: 'h'.repeat(64),
      frame: 'J2000',
      correction: 'NONE',
      computedAt: '2026-07-11T00:00:00.000Z',
      jobId: 'access-1',
    });
  });
});
