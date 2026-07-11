// The pinned wire encoding, proven: typed arrays round-trip through the
// JSON-safe f64le-base64 form bit-exactly, NaN included (the unresolved-cell
// marker of streamed field partials), and the hazard the pin exists for is
// demonstrated: bare JSON nulls NaN.

import { describe, it, expect } from 'vitest';
import {
  decodeAnalysisProduct,
  decodeF64,
  encodeAnalysisProduct,
  encodeF64,
  type AnalysisProduct,
  type Provenance,
} from './index.ts';

const PROVENANCE: Provenance = {
  engine: 'synthetic',
  version: '0.0.0',
  kernels: { setHash: 'a'.repeat(64), names: ['naif0012.tls'] },
  frame: 'J2000',
  correction: 'NONE',
  authority: 'exploratory',
  computedAt: '2026-07-11T00:00:00.000Z',
  jobId: 'synthetic-1',
};

describe('AnalysisProduct wire encoding (schema v0)', () => {
  it('round-trips Float64Array payloads bit-exactly, NaN included', () => {
    const values = Float64Array.from([0, -0, 1.5, Number.NaN, Number.MIN_VALUE, -1e300, Number.NaN]);
    const decoded = decodeF64(encodeF64(values));
    expect(decoded.length).toBe(values.length);
    for (let i = 0; i < values.length; i++) {
      // Object.is distinguishes NaN and negative zero; toEqual would not.
      expect(Object.is(decoded[i], values[i])).toBe(true);
    }
  });

  it('round-trips a field product through JSON with NaN cells intact', () => {
    const product: AnalysisProduct = {
      product: {
        kind: 'field',
        field: {
          name: 'percentCoverage',
          unit: 'percent',
          body: 'SATURN',
          frame: 'IAU_SATURN',
          latMin: -0.5,
          latMax: 0.5,
          latCount: 1,
          lonMin: 0,
          lonMax: 1,
          lonCount: 3,
          values: Float64Array.from([42.5, Number.NaN, 0]),
        },
      },
      provenance: PROVENANCE,
      units: { percentCoverage: 'percent' },
    };
    const wire = JSON.parse(JSON.stringify(encodeAnalysisProduct(product)));
    const back = decodeAnalysisProduct(wire);
    expect(back.provenance).toEqual(PROVENANCE);
    expect(back.units).toEqual({ percentCoverage: 'percent' });
    expect(back.product.kind).toBe('field');
    if (back.product.kind === 'field') {
      const v = back.product.field.values;
      expect(v).toBeInstanceOf(Float64Array);
      expect(v[0]).toBe(42.5);
      expect(Number.isNaN(v[1])).toBe(true);
      expect(v[2]).toBe(0);
    }
  });

  it('round-trips series and geometry payloads and passes intervals through', () => {
    const product: AnalysisProduct = {
      product: {
        kind: 'series',
        series: [
          {
            name: 'range',
            unit: 'km',
            et: Float64Array.from([0, 60]),
            values: Float64Array.from([100, Number.NaN]),
          },
        ],
      },
      provenance: PROVENANCE,
      units: { range: 'km' },
    };
    const back = decodeAnalysisProduct(JSON.parse(JSON.stringify(encodeAnalysisProduct(product))));
    if (back.product.kind === 'series') {
      expect(back.product.series[0]!.et).toEqual(Float64Array.from([0, 60]));
      expect(Number.isNaN(back.product.series[0]!.values[1])).toBe(true);
    }

    const intervals: AnalysisProduct = {
      product: { kind: 'intervals', sets: [{ label: 'a', intervals: [[0, 1]] }] },
      provenance: PROVENANCE,
      units: {},
    };
    const backI = decodeAnalysisProduct(
      JSON.parse(JSON.stringify(encodeAnalysisProduct(intervals))),
    );
    expect(backI.product).toEqual(intervals.product);
  });

  it('demonstrates the hazard the pin exists for: bare JSON nulls NaN', () => {
    expect(JSON.parse(JSON.stringify({ values: [1, Number.NaN, 3] })).values).toEqual([1, null, 3]);
  });

  it('fails loudly on unknown encodings and torn byte lengths', () => {
    expect(() =>
      decodeF64({ encoding: 'f64be-base64' as 'f64le-base64', data: '' }),
    ).toThrow(/unknown encoding/);
    expect(() => decodeF64({ encoding: 'f64le-base64', data: 'AAAA' })).toThrow(/multiple of 8/);
  });
});
