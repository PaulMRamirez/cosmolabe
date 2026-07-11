// The mount() contract (M-0007) and the four-form rendering, tested where
// node can see them: mode resolution throws loudly for the unimplemented
// compute modes before any DOM is touched, and the presentational pieces
// render each of the four M-0004 kinds to static markup. The full mount in
// a live host page is the e2e embed smoke test's evidence, not this file's.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisProduct, Product, Provenance } from '@bessel/compute';
import { mount, ProductView, ProvenanceChip } from './index.ts';

const provenance: Provenance = {
  engine: 'bessel-test',
  version: '0.0.0',
  kernels: { setHash: 'abcdef0123456789abcdef', names: ['naif0012.tls'] },
  frame: 'J2000',
  correction: 'NONE',
  authority: 'exploratory',
  computedAt: '2026-07-11T00:00:00Z',
  jobId: 'job-1',
};

const wrap = (product: Product): AnalysisProduct => ({ product, provenance, units: {} });

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('mount() compute-mode resolution', () => {
  it("throws loudly for 'threads' and 'iframe' before touching the node", () => {
    const node = {} as HTMLElement;
    const cfg = { data: {} };
    expect(() => mount(node, { ...cfg, compute: 'threads' })).toThrow(/SharedArrayBuffer/);
    expect(() => mount(node, { ...cfg, compute: 'iframe' })).toThrow(/M-0010/);
  });
});

describe('ProductView renders each of the four kinds', () => {
  it('intervals: one lane per set with the shared span', () => {
    const out = html(
      createElement(ProductView, {
        product: wrap({
          kind: 'intervals',
          sets: [
            { label: 'DSS-14', intervals: [[0, 60] as const, [120, 200] as const] },
            { label: 'DSS-43', intervals: [[30, 90] as const] },
          ],
        }),
      }),
    );
    expect(out).toContain('data-testid="panel-lanes"');
    expect(out).toContain('data-testid="panel-lane-DSS-14"');
    expect(out).toContain('data-testid="panel-lane-DSS-43"');
    expect(out).toContain('2 intervals');
  });

  it('series: one strip chart per series with a drawn polyline', () => {
    const out = html(
      createElement(ProductView, {
        product: wrap({
          kind: 'series',
          series: [
            {
              name: 'range',
              unit: 'km',
              et: new Float64Array([0, 60, 120]),
              values: new Float64Array([1000, 1200, 900]),
            },
          ],
        }),
      }),
    );
    expect(out).toContain('data-testid="panel-chart-range"');
    expect(out).not.toContain('data-testid="panel-chart-range-"');
    expect(out).toContain('<polyline');
  });

  it('geometry: the first layer drawn on the 2D ground-track map', () => {
    const out = html(
      createElement(ProductView, {
        product: wrap({
          kind: 'geometry',
          layers: [
            {
              label: 'track',
              frame: 'IAU_EARTH',
              form: 'polyline',
              positions: new Float64Array([6371, 0, 0, 0, 6371, 0, -6371, 0, 0]),
            },
          ],
        }),
      }),
    );
    expect(out).toContain('data-testid="panel-track"');
    expect(out).toContain('ground-track');
  });

  it('field: one rect per cell, NaN cells dim (unresolved)', () => {
    const out = html(
      createElement(ProductView, {
        product: wrap({
          kind: 'field',
          field: {
            name: 'visible',
            unit: 'count',
            body: 'EARTH',
            frame: 'IAU_EARTH',
            latMin: -1,
            latMax: 1,
            latCount: 2,
            lonMin: -2,
            lonMax: 2,
            lonCount: 2,
            values: new Float64Array([0, 50, 100, NaN]),
          },
        }),
      }),
    );
    expect(out).toContain('data-testid="panel-field-map"');
    expect(out.match(/<rect/g)).toHaveLength(4);
    expect(out).toContain('#8883');
  });
});

describe('ProvenanceChip', () => {
  it('labels exploratory products as computed here with the kernel set hash', () => {
    const out = html(createElement(ProvenanceChip, { provenance }));
    expect(out).toContain('Computed here');
    expect(out).toContain(provenance.kernels.setHash.slice(0, 16));
    expect(out).toContain('NONE');
  });

  it('labels host products as host data', () => {
    const out = html(
      createElement(ProvenanceChip, { provenance: { ...provenance, authority: 'host' } }),
    );
    expect(out).toContain('Host data');
  });
});
