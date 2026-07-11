import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  buildArrow,
  buildAtmosphereUniforms,
  buildDskGeometry,
  buildRingVertices,
  buildTriadBuffers,
  computeOrbitCameraPosition,
  computeShadowFrustum,
  computeTrackCameraPosition,
  rayleighCoefficients,
  rowMajor3x3ToMatrix4,
  type Km3,
} from './index.ts';

describe('@bessel/scene rings', () => {
  it('builds an annulus with radii between inner and outer (scaled)', () => {
    const { positions } = buildRingVertices(74500, 140220, 16);
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i]!, positions[i + 1]!) * 1e6; // unscale to km
      expect(r).toBeGreaterThanOrEqual(74500 - 1);
      expect(r).toBeLessThanOrEqual(140220 + 1);
      expect(positions[i + 2]).toBe(0); // ring lies in the body equatorial plane
    }
  });
});

describe('@bessel/scene axis triad and orientation', () => {
  it('builds six vertices (three colored segments) from the origin', () => {
    const { positions, colors } = buildTriadBuffers(2);
    expect(positions.length).toBe(18);
    expect(colors.length).toBe(18);
    expect([positions[3], positions[4], positions[5]]).toEqual([2, 0, 0]); // +X tip
  });

  it('rowMajor3x3ToMatrix4 transposes correctly (90deg Z maps +X to +Y)', () => {
    const rz90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const v = new Vector3(1, 0, 0).applyMatrix4(rowMajor3x3ToMatrix4(rz90));
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
  });
});

describe('@bessel/scene direction vectors', () => {
  it('normalizes a direction and scales the tip to the length', () => {
    const arrow = buildArrow([3, 0, 4] as Km3, 10);
    expect(Math.hypot(...arrow.direction)).toBeCloseTo(1, 6);
    expect(arrow.tip).toEqual([6, 0, 8]);
  });
});

describe('@bessel/scene camera modes', () => {
  it('track places the camera behind the velocity direction', () => {
    const v: Km3 = [0, 0, 1];
    const pos = computeTrackCameraPosition(v, 10, 0);
    expect(pos[2]).toBeLessThan(0); // behind +Z velocity
    expect(Math.hypot(...pos)).toBeCloseTo(10, 4);
  });
  it('track returns a safe default for near-zero velocity', () => {
    expect(() => computeTrackCameraPosition([0, 0, 0], 5)).not.toThrow();
    expect(Math.hypot(...computeTrackCameraPosition([0, 0, 0], 5))).toBeGreaterThan(0);
  });
  it('orbit position sits at the requested distance', () => {
    expect(Math.hypot(...computeOrbitCameraPosition(0.5, 0.3, 12))).toBeCloseTo(12, 4);
  });
});

describe('@bessel/scene atmosphere and shadows', () => {
  it('Rayleigh scatters blue more than red', () => {
    const [r, g, b] = rayleighCoefficients();
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });
  it('packs atmosphere uniforms', () => {
    const u = buildAtmosphereUniforms({ sunDirection: [1, 0, 0], intensity: 2 });
    expect(u.uSunDirection.value.x).toBe(1);
    expect(u.uIntensity.value).toBe(2);
    expect(u.uRayleigh.value.z).toBeGreaterThan(u.uRayleigh.value.x);
  });
  it('shadow frustum encloses the body with margin and near < far', () => {
    const f = computeShadowFrustum(0.06, 2000);
    expect(f.halfExtent).toBeGreaterThan(0.06);
    expect(f.near).toBeLessThan(f.far);
    expect(f.near).toBeGreaterThan(0);
  });
});

describe('@bessel/scene DSK mesh', () => {
  it('builds a non-indexed geometry with three vertices per plate', () => {
    const vertices = [0, 0, 0, 1e6, 0, 0, 0, 1e6, 0, 0, 0, 1e6];
    const plates = [0, 1, 2, 0, 1, 3];
    const geo = buildDskGeometry(vertices, plates);
    expect(geo.getAttribute('position').count).toBe(plates.length); // 6 vertices
    expect(geo.getAttribute('normal')).toBeDefined(); // normals computed for shading
  });
});
