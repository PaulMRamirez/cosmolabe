// Time-evolving swath: a footprint ring per sample, and a coverage metric that grows
// as the sensor moves (a sweep covers more than a stare). (STK_PARITY_SPEC §4.7.)

import { describe, it, expect } from 'vitest';
import {
  accumulateSwath,
  swathCovers,
  swathCoverageFraction,
  type SensorSchema,
  type SwathSample,
  type SwathOccluder,
} from './swath.ts';
import type { Vec3 } from './index.ts';

const schema: SensorSchema = { name: 'cam', kind: 'conic', halfAngleRad: 0.1 };
const center: Vec3 = { x: 0, y: 0, z: 0 };
const radius = 1;

// Nadir samples at altitude 1 (apex at radius+1 along +z, looking down -z), stepping
// the apex in x to sweep the sub-point across the sphere's north area.
function sampleAt(x: number): SwathSample {
  return { apex: { x, y: 0, z: 2 }, boresight: { x: 0, y: 0, z: -1 } };
}

describe('accumulateSwath', () => {
  it('produces one boundary ring per sample', () => {
    const swath = accumulateSwath([sampleAt(0), sampleAt(0.1)], schema, center, radius, 16);
    expect(swath.rings).toHaveLength(2);
    expect(swath.rings[0]!.length).toBeGreaterThan(0);
    expect(swath.points.length).toBe(swath.rings.flat().length);
  });
});

describe('swath coverage', () => {
  it('covers the sub-point under a nadir stare', () => {
    const samples = [sampleAt(0)];
    expect(swathCovers({ x: 0, y: 0, z: 1 }, samples, schema)).toBe(true); // north pole sub-point
    expect(swathCovers({ x: 1, y: 0, z: 0 }, samples, schema)).toBe(false); // equator, out of FOV
  });

  it('does NOT cover a far-hemisphere point when occlusion is checked (wide nadir FOV)', () => {
    // A very wide nadir sensor at the north pole apex. Its FOV cone is wide enough to nominally
    // include the SOUTH pole point (x=0,y=0,z=-1), which lies inside the cone but behind the body.
    const wide: SensorSchema = { name: 'wide', kind: 'conic', halfAngleRad: Math.PI / 2 - 0.01 };
    const apex: Vec3 = { x: 0, y: 0, z: 2 };
    const samples: SwathSample[] = [{ apex, boresight: { x: 0, y: 0, z: -1 } }];
    const occ: SwathOccluder = { center, radius };
    const nearPoint: Vec3 = { x: 0, y: 0, z: 1 }; // north pole, sub-satellite (visible)
    const farPoint: Vec3 = { x: 0, y: 0, z: -1 }; // south pole, behind the body (occluded)

    // Without an occluder the cone alone over-reports: both points test "covered".
    expect(swathCovers(nearPoint, samples, wide)).toBe(true);
    expect(swathCovers(farPoint, samples, wide)).toBe(true);
    // With the occluder, the near point stays covered but the far-hemisphere point is rejected.
    expect(swathCovers(nearPoint, samples, wide, occ)).toBe(true);
    expect(swathCovers(farPoint, samples, wide, occ)).toBe(false);
    // The coverage fraction over both points halves once occlusion is enforced.
    expect(swathCoverageFraction([nearPoint, farPoint], samples, wide)).toBeCloseTo(1, 12);
    expect(swathCoverageFraction([nearPoint, farPoint], samples, wide, occ)).toBeCloseTo(0.5, 12);
  });

  it('a moving sweep covers more test points than a single stare', () => {
    // Test points along a small arc near the north pole.
    const testPoints: Vec3[] = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * 0.3; // small polar angle
      return { x: Math.sin(a), y: 0, z: Math.cos(a) };
    });
    const stare = swathCoverageFraction(testPoints, [sampleAt(0)], schema);
    const sweep = swathCoverageFraction(
      testPoints,
      Array.from({ length: 10 }, (_, i) => sampleAt(i * 0.1)),
      schema,
    );
    expect(sweep).toBeGreaterThan(stare);
  });
});
