// B13: illumination readouts are driven by each catalog body's declared
// body-fixed frame (or the generic IAU convention), not a 6-planet allowlist.
// A moon with a furnished frame now resolves; an unresolvable frame fails loud
// to n/a via the existing subpnt/ilumin try/catch.

import { describe, it, expect } from 'vitest';
import type { BesselCatalog } from '@bessel/catalog';
import type { SpiceEngine } from '@bessel/spice';
import { buildBodyFrameMap, resolveBodyFrame, computeReadouts } from './readouts.ts';

describe('resolveBodyFrame', () => {
  it('prefers the catalog-declared frame for a body', () => {
    const map = new Map([['Titan', 'CASSINI_TITAN']]);
    expect(resolveBodyFrame('Titan', map)).toBe('CASSINI_TITAN');
  });

  it('falls back to the IAU convention, uppercasing and underscoring spaces', () => {
    expect(resolveBodyFrame('Enceladus')).toBe('IAU_ENCELADUS');
    expect(resolveBodyFrame('  the moon ')).toBe('IAU_THE_MOON');
  });

  it('returns null for the Sun (degenerate illumination)', () => {
    expect(resolveBodyFrame('Sun')).toBeNull();
    expect(resolveBodyFrame('sun', new Map([['sun', 'IAU_SUN']]))).toBeNull();
  });
});

describe('buildBodyFrameMap', () => {
  it('maps both name and id for Spice-orientation bodies and omits the rest', () => {
    const catalog: BesselCatalog = {
      version: '1.0',
      bodies: [
        { id: '606', name: 'Titan', orientation: { type: 'Spice', frame: 'CASSINI_TITAN' } },
        { id: '301', name: 'Moon', orientation: { type: 'UniformRotation', axis: [0, 0, 1], ratePerSec: 1 } },
        { id: '999', name: 'Plain' },
      ],
    };
    const map = buildBodyFrameMap(catalog);
    expect(map.get('Titan')).toBe('CASSINI_TITAN');
    expect(map.get('606')).toBe('CASSINI_TITAN');
    expect(map.has('Moon')).toBe(false);
    expect(map.has('Plain')).toBe(false);
  });
});

// A mock SPICE that resolves geometry only for a named frame; any other frame
// throws, exercising the fail-loud n/a path.
function mockSpice(opts: { readonly resolvableFrame?: string } = {}): SpiceEngine {
  const engine = {
    spkpos: async () => ({ position: { x: 1000, y: 0, z: 0 }, lightTime: 0 }),
    bodvrd: async () => [600, 600, 600],
    subpnt: async (_method: string, _t: string, _et: number, frame: string) => {
      if (opts.resolvableFrame && frame === opts.resolvableFrame) {
        return { point: [600, 0, 0], observerToPoint: [400, 0, 0] };
      }
      throw new Error(`frame ${frame} not in kernels`);
    },
    ilumin: async () => ({ phase: Math.PI / 4, incidence: Math.PI / 6, emission: Math.PI / 3 }),
  };
  return engine as unknown as SpiceEngine;
}

describe('computeReadouts illumination', () => {
  it('produces non-null angles for a non-allowlist moon whose frame resolves', async () => {
    const frames = new Map([['Titan', 'CASSINI_TITAN']]);
    const r = await computeReadouts(mockSpice({ resolvableFrame: 'CASSINI_TITAN' }), 'Titan', '606', 0, 'Probe', frames);
    expect(r.phaseDeg).toBeCloseTo(45, 6);
    expect(r.incidenceDeg).toBeCloseTo(30, 6);
    expect(r.emissionDeg).toBeCloseTo(60, 6);
  });

  it('resolves via the generic IAU frame with no catalog map', async () => {
    const r = await computeReadouts(mockSpice({ resolvableFrame: 'IAU_ENCELADUS' }), 'Enceladus', '602', 0, 'Probe');
    expect(r.phaseDeg).toBeCloseTo(45, 6);
  });

  it('leaves angles n/a when the frame is unresolvable (fail loud)', async () => {
    const r = await computeReadouts(mockSpice(), 'Mimas', '601', 0, 'Probe');
    expect(r.phaseDeg).toBeNull();
    expect(r.incidenceDeg).toBeNull();
    expect(r.emissionDeg).toBeNull();
    // Range and altitude still resolve from spkpos/bodvrd.
    expect(r.rangeKm).toBeCloseTo(1000, 6);
  });

  it('keeps the Sun n/a (no illumination attempt)', async () => {
    const r = await computeReadouts(mockSpice({ resolvableFrame: 'IAU_SUN' }), 'Sun', '10', 0, 'Probe');
    expect(r.phaseDeg).toBeNull();
  });
});
