// The first host data adapter (ADR M-0011): MMGIS-shaped computed layers
// mapped to AnalysisProduct values carrying authority 'host'. This module
// is the one sanctioned construction site of 'host' authority in the
// entire tree (iron rule 4): engines emit 'exploratory' and submitJob
// refuses jobs asserting authority, so host authority can only enter
// through an adapter like this one, and the adapter's duty is fidelity,
// not computation: every provenance field carries the host's own identity
// in the host's own terms (its tool name as the engine, its dataset uuid
// as the kernel set identity, its generation timestamp as computedAt). The
// one conversion performed is geometric and documented at this boundary
// per rule 9: MMGIS map-convention lon/lat degrees become body-fixed
// planetocentric x, y, z kilometers on the layer's stated sphere radius,
// because the geometry contract carries positions in kilometers.
// correction is 'NONE' stated literally: this adapter asserts no
// light-time model on the host's behalf.

import type { AnalysisProduct, GeoLayer } from '@bessel/compute';
import type { HostDataAdapter, HostComputeAdapter } from './index.ts';

/** An MMGIS-shaped computed layer, in MMGIS's own terms: the map-convention
 *  coordinates of a computed (not authored) layer plus the provenance MMGIS
 *  itself records about it. A faithful shape, honestly not MMGIS's exact
 *  wire format; the real integration refines this against the MMGIS
 *  repository when that work is scheduled. */
export interface MmgisComputedLayer {
  /** Layer display name, e.g. "Traverse path (sol 3125)". */
  readonly name: string;
  readonly mission: string;
  /** The MMGIS tool that computed the layer (its engine, in host terms). */
  readonly tool: string;
  readonly toolVersion: string;
  /** The host's own stable identifier for the computed dataset. */
  readonly layerUuid: string;
  /** When the host computed it (ISO). */
  readonly generatedAt: string;
  /** The body the coordinates lie on and its body-fixed frame and radius. */
  readonly crs: { readonly body: string; readonly frame: string; readonly radiusKm: number };
  readonly form: 'polyline' | 'points';
  /** Map-convention [lon, lat] pairs, degrees. */
  readonly coordinates: readonly (readonly [number, number])[];
}

/** The documented boundary conversion: map-convention degrees to body-fixed
 *  planetocentric kilometers on the layer's sphere radius. */
export function mmgisLayerToGeoLayer(layer: MmgisComputedLayer): GeoLayer {
  const positions = new Float64Array(layer.coordinates.length * 3);
  for (let i = 0; i < layer.coordinates.length; i++) {
    const [lonDeg, latDeg] = layer.coordinates[i]!;
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;
    const r = layer.crs.radiusKm;
    positions[i * 3] = r * Math.cos(lat) * Math.cos(lon);
    positions[i * 3 + 1] = r * Math.cos(lat) * Math.sin(lon);
    positions[i * 3 + 2] = r * Math.sin(lat);
  }
  return { label: layer.name, frame: layer.crs.frame, form: layer.form, positions };
}

/** Map one MMGIS computed layer to a host-authority product, provenance
 *  carried faithfully in the host's own terms (M-0011). */
export function mmgisLayerToProduct(layer: MmgisComputedLayer): AnalysisProduct {
  return {
    product: { kind: 'geometry', layers: [mmgisLayerToGeoLayer(layer)] },
    provenance: {
      engine: `mmgis:${layer.tool}`,
      version: layer.toolVersion,
      // For host products the kernel-set identity is the host's dataset
      // identity: the uuid MMGIS assigned the computed layer, prefixed so a
      // provenance row can never be mistaken for one of our kernel hashes.
      kernels: { setHash: `host:${layer.layerUuid}`, names: [layer.name] },
      frame: layer.crs.frame,
      correction: 'NONE',
      authority: 'host',
      computedAt: layer.generatedAt,
      jobId: layer.layerUuid,
    },
    units: { [layer.name]: 'km' },
  };
}

/** The first HostDataAdapter: host products from MMGIS-shaped layers, plus
 *  optional fallback compute so one mounted surface carries authoritative
 *  and exploratory products side by side (the PlanDev source-of-truth
 *  criterion of docs/design/01). */
export function createMmgisDataAdapter(
  layers: readonly MmgisComputedLayer[],
  compute?: HostComputeAdapter,
): HostDataAdapter {
  return {
    products: () => Promise.resolve(layers.map(mmgisLayerToProduct)),
    ...(compute ? { compute } : {}),
  };
}
