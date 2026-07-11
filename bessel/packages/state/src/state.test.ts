import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_VIEW,
  CzmlError,
  buildMmgisUrl,
  decodeView,
  encodeView,
  exportCzml,
  type CameraMode,
  type ViewModel,
} from './index.ts';

const finite = (): fc.Arbitrary<number> =>
  fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });

const viewArb: fc.Arbitrary<ViewModel> = fc.record({
  t: fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z') }).map(
    (d) => d.toISOString(),
  ),
  camera: fc.record({
    mode: fc.constantFrom<CameraMode>('orbit', 'center', 'track'),
    target: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    distance: finite(),
    azimuth: finite(),
    elevation: finite(),
  }),
  selection: fc.array(fc.string()),
  visibility: fc.dictionary(fc.string(), fc.boolean()),
  plugins: fc.array(fc.string()),
});

describe('@bessel/state view URL codec', () => {
  it('round-trips: decode(encode(view)) equals view', () => {
    fc.assert(
      fc.property(viewArb, (view) => {
        const decoded = decodeView(encodeView(view));
        expect(decoded).toEqual(normalize(view));
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips the default view through a fragment with a leading hash', () => {
    expect(decodeView(`#${encodeView(DEFAULT_VIEW)}`)).toEqual(DEFAULT_VIEW);
  });
});

// The codec drops an undefined target and maps negative zero to positive zero
// (both numerically equal); normalize the expectation accordingly so equality is
// exact under Vitest's Object.is comparison of zeros.
function normalize(view: ViewModel): ViewModel {
  const { target, distance, azimuth, elevation } = view.camera;
  const camera = {
    mode: view.camera.mode,
    distance: distance + 0,
    azimuth: azimuth + 0,
    elevation: elevation + 0,
    ...(target === undefined ? {} : { target }),
  };
  return { ...view, camera };
}

describe('@bessel/state MMGIS deep links', () => {
  const config = { host: 'https://mmgis.example/', mission: 'CASSINI' };

  it('always sends the mapLon, mapLat, mapZoom triple', () => {
    const url = new URL(buildMmgisUrl(config, { lon: -12.5, lat: 30.2 }));
    expect(url.searchParams.get('mission')).toBe('CASSINI');
    expect(url.searchParams.get('mapLon')).toBe('-12.5');
    expect(url.searchParams.get('mapLat')).toBe('30.2');
    expect(url.searchParams.has('mapZoom')).toBe(true);
  });

  it('derives a higher zoom for a smaller footprint and includes optional fields', () => {
    const small = new URL(buildMmgisUrl(config, { lon: 0, lat: 0, footprintAngularSizeDeg: 0.1 }));
    const large = new URL(buildMmgisUrl(config, { lon: 0, lat: 0, footprintAngularSizeDeg: 10 }));
    expect(Number(small.searchParams.get('mapZoom'))).toBeGreaterThan(
      Number(large.searchParams.get('mapZoom')),
    );
    const withTime = new URL(
      buildMmgisUrl(config, {
        lon: 1,
        lat: 2,
        centerPin: 'CASSINI_ISS_NAC @ 2006-07-22',
        startTime: '2006-07-22T12:00:00Z',
        endTime: '2006-07-22T12:30:00Z',
      }),
    );
    expect(withTime.searchParams.get('centerPin')).toContain('CASSINI_ISS_NAC');
    expect(withTime.searchParams.get('startTime')).toBe('2006-07-22T12:00:00Z');
  });
});

describe('@bessel/state CZML export', () => {
  it('produces a valid CZML document and a sampled entity', () => {
    const czml = exportCzml({
      id: 'CASSINI',
      name: 'Cassini',
      start: '2004-07-01T00:00:00Z',
      stop: '2004-07-01T02:00:00Z',
      samples: [
        { t: '2004-07-01T00:00:00Z', position: [1, 2, 3] },
        { t: '2004-07-01T01:00:00Z', position: [4, 5, 6] },
        { t: '2004-07-01T02:00:00Z', position: [7, 8, 9] },
      ],
    });
    expect(Array.isArray(czml)).toBe(true);
    const doc = czml[0] as { id: string; version: string; clock: { interval: string } };
    expect(doc.id).toBe('document');
    expect(doc.version).toBe('1.0');
    expect(doc.clock.interval).toBe('2004-07-01T00:00:00Z/2004-07-01T02:00:00Z');

    const entity = czml[1] as { id: string; position: { cartesian: number[]; epoch: string } };
    expect(entity.id).toBe('CASSINI');
    // 3 samples x (time + xyz) = 12 numbers; positions are metres (km x 1000).
    expect(entity.position.cartesian).toHaveLength(12);
    expect(entity.position.cartesian[0]).toBe(0);
    expect(entity.position.cartesian[1]).toBe(1000);
    expect(entity.position.cartesian[4]).toBe(3600);
  });

  it('fails loudly on a non-finite start epoch instead of emitting null', () => {
    expect(() =>
      exportCzml({
        id: 'X',
        name: 'X',
        start: 'not-a-date',
        stop: '2004-07-01T02:00:00Z',
        samples: [{ t: '2004-07-01T00:00:00Z', position: [1, 2, 3] }],
      }),
    ).toThrow(CzmlError);
  });

  it('fails loudly on a non-finite sample time instead of emitting null', () => {
    expect(() =>
      exportCzml({
        id: 'X',
        name: 'X',
        start: '2004-07-01T00:00:00Z',
        stop: '2004-07-01T02:00:00Z',
        samples: [{ t: 'garbage', position: [1, 2, 3] }],
      }),
    ).toThrow(/garbage/);
  });
});

describe('@bessel/state camera fragment hardening', () => {
  it('falls back to default pose fields for a truncated/hostile fragment', () => {
    // A hostile fragment with non-numeric pose fields must not yield NaN distance/
    // azimuth/elevation (the camera-relative renderer would draw a garbage frame).
    const view = decodeView('cam=orbit::evil,NaN,');
    expect(Number.isFinite(view.camera.distance)).toBe(true);
    expect(Number.isFinite(view.camera.azimuth)).toBe(true);
    expect(Number.isFinite(view.camera.elevation)).toBe(true);
    expect(view.camera).toMatchObject({ mode: 'orbit', distance: 1, azimuth: 0, elevation: 0 });
  });
});
