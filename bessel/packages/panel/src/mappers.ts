// Pure product-to-form mappers for the panel's 2D canonical forms. The panel
// carries no 3D scene: geometry renders on the 2D ground-track map and the
// field as a flat heatmap grid; the in-scene drapes belong to scene hosts
// through the render-binding interface (the inventoried weld).

import type { Field, GeoLayer } from '@bessel/compute';

/** Body-fixed polyline positions (km) to planetocentric lon/lat (radians). */
export function layerToLonLat(layer: GeoLayer): { lon: Float64Array; lat: Float64Array } {
  const n = Math.floor(layer.positions.length / 3);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = layer.positions[i * 3]!;
    const y = layer.positions[i * 3 + 1]!;
    const z = layer.positions[i * 3 + 2]!;
    lon[i] = Math.atan2(y, x);
    lat[i] = Math.atan2(z, Math.hypot(x, y));
  }
  return { lon, lat };
}

export interface FieldCellRect {
  readonly row: number;
  readonly col: number;
  /** Value in the field's unit, or null while unresolved (NaN). */
  readonly value: number | null;
}

/** Column and row counts of either field domain (M-0004 amendment 1). */
export function fieldCounts(field: Field): { cols: number; rows: number } {
  return field.domain === 'grid'
    ? { cols: field.x.count, rows: field.y.count }
    : { cols: field.lonCount, rows: field.latCount };
}

/** Row-major field values to renderable cells (NaN marked unresolved),
 *  domain-agnostic: body drapes and named-axes grids share the layout. */
export function fieldToCells(field: Field): FieldCellRect[] {
  const { cols, rows } = fieldCounts(field);
  const out: FieldCellRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = field.values[r * cols + c]!;
      out.push({ row: r, col: c, value: Number.isFinite(v) ? v : null });
    }
  }
  return out;
}
