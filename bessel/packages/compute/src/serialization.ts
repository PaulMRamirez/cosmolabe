// The pinned wire encoding for AnalysisProduct payloads (schema v0). In
// memory, payloads are Float64Array. In serialized form, every Float64Array
// encodes as { encoding: 'f64le-base64', data } : the base64 of the array's
// little-endian IEEE 754 bytes, independent of platform endianness. NaN
// policy, stated because it is load-bearing: NaN marks an unresolved field
// cell in streamed partials, it survives this encoding bit-exactly, and bare
// JSON.stringify of a number sequence must never carry a payload, because
// JSON nulls NaN (the hazard is pinned by test). The CLI file format and any
// cross-process transport are named consumers of exactly this encoding.
// Interval endpoints remain plain JSON numbers: they are finite ET seconds by
// construction and never carry NaN.

import type {
  AnalysisProduct,
  FieldAxis,
  GeoLayer,
  Product,
  Provenance,
  ScalarField,
  TimeSeries,
  UnitMap,
} from './product.ts';

export interface EncodedF64 {
  readonly encoding: 'f64le-base64';
  readonly data: string;
}

export interface SerializedTimeSeries {
  readonly name: string;
  readonly unit: string;
  readonly et: EncodedF64;
  readonly values: EncodedF64;
}

export interface SerializedGeoLayer {
  readonly label: string;
  readonly frame: GeoLayer['frame'];
  readonly form: GeoLayer['form'];
  readonly positions: EncodedF64;
}

export interface SerializedScalarField {
  readonly domain?: 'body';
  readonly name: string;
  readonly unit: string;
  readonly body: string;
  readonly frame: ScalarField['frame'];
  readonly latMin: number;
  readonly latMax: number;
  readonly latCount: number;
  readonly lonMin: number;
  readonly lonMax: number;
  readonly lonCount: number;
  readonly values: EncodedF64;
}

/** The grid-domain field of M-0004 amendment 1 in wire form (axes are plain
 *  JSON; only the cell values byte-encode). */
export interface SerializedGridField {
  readonly domain: 'grid';
  readonly name: string;
  readonly unit: string;
  readonly x: FieldAxis;
  readonly y: FieldAxis;
  readonly values: EncodedF64;
}

export type SerializedField = SerializedScalarField | SerializedGridField;

export type SerializedProduct =
  | Extract<Product, { kind: 'intervals' }>
  | { kind: 'series'; series: SerializedTimeSeries[] }
  | { kind: 'geometry'; layers: SerializedGeoLayer[] }
  | { kind: 'field'; field: SerializedField };

export interface SerializedAnalysisProduct {
  readonly product: SerializedProduct;
  readonly provenance: Provenance;
  readonly units: UnitMap;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64[c & 63]! : '=';
  }
  return out;
}

function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => {
      const ch = clean[i + k];
      if (ch === undefined) return 0;
      const v = B64_INDEX.get(ch);
      if (v === undefined) throw new Error(`decodeF64: invalid base64 character '${ch}'`);
      return v;
    }) as [number, number, number, number];
    if (o < out.length) out[o++] = (n[0] << 2) | (n[1] >> 4);
    if (o < out.length) out[o++] = ((n[1] & 15) << 4) | (n[2] >> 2);
    if (o < out.length) out[o++] = ((n[2] & 3) << 6) | n[3];
  }
  return out;
}

/** Encode a Float64Array as base64 of its little-endian bytes (NaN bit-exact). */
export function encodeF64(values: Float64Array): EncodedF64 {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return { encoding: 'f64le-base64', data: bytesToBase64(bytes) };
}

/** Decode the f64le-base64 wire form back to a Float64Array. */
export function decodeF64(encoded: EncodedF64): Float64Array {
  if (encoded.encoding !== 'f64le-base64') {
    throw new Error(`decodeF64: unknown encoding '${String(encoded.encoding)}'`);
  }
  const bytes = base64ToBytes(encoded.data);
  if (bytes.length % 8 !== 0) {
    throw new Error(`decodeF64: byte length ${bytes.length} is not a multiple of 8`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(bytes.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat64(i * 8, true);
  return out;
}

const encodeSeries = (s: TimeSeries): SerializedTimeSeries => ({
  name: s.name,
  unit: s.unit,
  et: encodeF64(s.et),
  values: encodeF64(s.values),
});

const decodeSeries = (s: SerializedTimeSeries): TimeSeries => ({
  name: s.name,
  unit: s.unit,
  et: decodeF64(s.et),
  values: decodeF64(s.values),
});

/** AnalysisProduct to its JSON-safe wire form (typed arrays byte-encoded). */
export function encodeAnalysisProduct(p: AnalysisProduct): SerializedAnalysisProduct {
  const product = ((): SerializedProduct => {
    switch (p.product.kind) {
      case 'intervals':
        return p.product;
      case 'series':
        return { kind: 'series', series: p.product.series.map(encodeSeries) };
      case 'geometry':
        return {
          kind: 'geometry',
          layers: p.product.layers.map((l) => ({
            label: l.label,
            frame: l.frame,
            form: l.form,
            positions: encodeF64(l.positions),
          })),
        };
      case 'field':
        return { kind: 'field', field: { ...p.product.field, values: encodeF64(p.product.field.values) } };
    }
  })();
  return { product, provenance: p.provenance, units: p.units };
}

/** The wire form back to an in-memory AnalysisProduct. */
export function decodeAnalysisProduct(s: SerializedAnalysisProduct): AnalysisProduct {
  const product = ((): Product => {
    switch (s.product.kind) {
      case 'intervals':
        return s.product;
      case 'series':
        return { kind: 'series', series: s.product.series.map(decodeSeries) };
      case 'geometry':
        return {
          kind: 'geometry',
          layers: s.product.layers.map((l) => ({
            label: l.label,
            frame: l.frame,
            form: l.form,
            positions: decodeF64(l.positions),
          })),
        };
      case 'field':
        return { kind: 'field', field: { ...s.product.field, values: decodeF64(s.product.field.values) } };
    }
  })();
  return { product, provenance: s.provenance, units: s.units };
}
