// The first host data adapter, pinned: the mapping is faithful (host
// provenance in host terms, authority 'host' set here and only here), the
// boundary conversion is correct (map-convention degrees to body-fixed
// planetocentric kilometers), and the adapter shape satisfies the
// HostDataAdapter contract.

import { describe, expect, it } from 'vitest';
import {
  createMmgisDataAdapter,
  mmgisLayerToGeoLayer,
  mmgisLayerToProduct,
  type MmgisComputedLayer,
} from './index.ts';

const layer: MmgisComputedLayer = {
  name: 'Traverse path (sol 3125)',
  mission: 'MSL',
  tool: 'PathTool',
  toolVersion: '2.9.1',
  layerUuid: 'a1b2c3d4',
  generatedAt: '2026-07-01T12:00:00Z',
  crs: { body: 'MARS', frame: 'IAU_MARS', radiusKm: 3389.5 },
  form: 'polyline',
  coordinates: [
    [0, 0],
    [90, 0],
    [0, 90],
  ],
};

describe('mmgisLayerToGeoLayer (the documented boundary conversion)', () => {
  it('maps map-convention degrees to planetocentric km on the stated radius', () => {
    const geo = mmgisLayerToGeoLayer(layer);
    expect(geo.frame).toBe('IAU_MARS');
    expect(geo.form).toBe('polyline');
    const r = 3389.5;
    // (0, 0) is +x at one radius.
    expect(geo.positions[0]).toBeCloseTo(r, 9);
    expect(geo.positions[1]).toBeCloseTo(0, 9);
    expect(geo.positions[2]).toBeCloseTo(0, 9);
    // (90 E, 0) is +y.
    expect(geo.positions[3]).toBeCloseTo(0, 9);
    expect(geo.positions[4]).toBeCloseTo(r, 9);
    // (anything, 90 N) is +z.
    expect(geo.positions[8]).toBeCloseTo(r, 9);
  });
});

describe('mmgisLayerToProduct (the host-authority door, M-0011)', () => {
  it('carries host provenance faithfully in host terms with authority host', () => {
    const product = mmgisLayerToProduct(layer);
    expect(product.provenance.authority).toBe('host');
    expect(product.provenance.engine).toBe('mmgis:PathTool');
    expect(product.provenance.version).toBe('2.9.1');
    // The kernel-set identity is the host's dataset identity, prefixed so it
    // can never be mistaken for one of our kernel hashes.
    expect(product.provenance.kernels.setHash).toBe('host:a1b2c3d4');
    expect(product.provenance.computedAt).toBe('2026-07-01T12:00:00Z');
    expect(product.provenance.jobId).toBe('a1b2c3d4');
    expect(product.provenance.correction).toBe('NONE');
    expect(product.product.kind).toBe('geometry');
  });
});

describe('createMmgisDataAdapter', () => {
  it('yields host products and carries fallback compute through untouched', async () => {
    const adapter = createMmgisDataAdapter([layer]);
    const products = await adapter.products!();
    expect(products).toHaveLength(1);
    expect(products[0]!.provenance.authority).toBe('host');
    expect(adapter.compute).toBeUndefined();
  });
});
