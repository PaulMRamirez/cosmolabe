// Item 5 (vector-set-view): azimuthElevationFromDirection must be the inverse of
// computeOrbitCameraPosition, so that setting the camera to the returned angles
// makes it look ALONG the requested direction toward the focus.

import { describe, it, expect } from 'vitest';
import {
  azimuthElevationFromDirection,
  computeOrbitCameraPosition,
  craneOffsetFraction,
  dollyFactor,
} from './camera-modes.ts';

describe('azimuthElevationFromDirection', () => {
  it('places the camera opposite the look direction', () => {
    // Look along +x: the camera should sit at -x.
    const { azimuth, elevation } = azimuthElevationFromDirection([1, 0, 0]);
    const pos = computeOrbitCameraPosition(azimuth, elevation, 10);
    expect(pos[0]).toBeCloseTo(-10, 6);
    expect(pos[1]).toBeCloseTo(0, 6);
    expect(pos[2]).toBeCloseTo(0, 6);
  });

  it('round-trips an arbitrary direction (view direction = -camera position)', () => {
    const dir: [number, number, number] = [0.3, -0.8, 0.5];
    const m = Math.hypot(...dir);
    const { azimuth, elevation } = azimuthElevationFromDirection(dir);
    const pos = computeOrbitCameraPosition(azimuth, elevation, 1);
    // The unit look direction is minus the unit camera position.
    expect(-pos[0]).toBeCloseTo(dir[0] / m, 6);
    expect(-pos[1]).toBeCloseTo(dir[1] / m, 6);
    expect(-pos[2]).toBeCloseTo(dir[2] / m, 6);
  });

  it('returns a safe default for a near-zero vector', () => {
    expect(azimuthElevationFromDirection([0, 0, 0])).toEqual({ azimuth: 0, elevation: 0 });
  });
});

describe('dollyFactor', () => {
  it('is 1 (no move) at zero', () => {
    expect(dollyFactor(0)).toBeCloseTo(1, 9);
  });
  it('moves the camera closer for a forward dolly and farther for a backward one', () => {
    expect(dollyFactor(0.2)).toBeLessThan(1); // forward: distance shrinks
    expect(dollyFactor(-0.2)).toBeGreaterThan(1); // backward: distance grows
  });
  it('stays strictly positive so a forward dolly never crosses the focus', () => {
    expect(dollyFactor(100)).toBeGreaterThan(0);
  });
});

describe('craneOffsetFraction', () => {
  it('passes the vertical fraction through (positive raises the viewpoint)', () => {
    expect(craneOffsetFraction(0.3)).toBe(0.3);
    expect(craneOffsetFraction(-0.5)).toBe(-0.5);
  });
});
