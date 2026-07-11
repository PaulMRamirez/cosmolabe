import { describe, it, expect } from 'vitest';
import {
  eigenCov2,
  buildBPlaneGeometry,
  ellipsePoints,
  combineEncounter,
  BPlaneGeometryError,
} from './bplane-geometry.ts';

// The B-plane geometry is pure: the 2x2-covariance eigen-decomposition (ellipse axes from a
// symmetric covariance) and the miss/extent are unit-tested directly.

describe('eigenCov2 (symmetric 2x2 eigen-decomposition)', () => {
  it('returns the diagonal variances as eigenvalues for an axis-aligned covariance', () => {
    const e = eigenCov2({ cxx: 4, cxy: 0, cyy: 1 });
    expect(e.major).toBeCloseTo(4, 9);
    expect(e.minor).toBeCloseTo(1, 9);
    // The major axis aligns with +x (cxx > cyy), so angle 0.
    expect(e.angleRad).toBeCloseTo(0, 9);
  });

  it('orients the major axis at 90 deg when the larger variance is on y', () => {
    const e = eigenCov2({ cxx: 1, cxy: 0, cyy: 9 });
    expect(e.major).toBeCloseTo(9, 9);
    expect(e.minor).toBeCloseTo(1, 9);
    expect(Math.abs(e.angleRad)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('rotates the principal axes for a cross-correlated covariance (45 deg)', () => {
    // [[2,1],[1,2]] has eigenvalues 3 and 1; the major eigenvector is along (1,1) -> 45 deg.
    const e = eigenCov2({ cxx: 2, cxy: 1, cyy: 2 });
    expect(e.major).toBeCloseTo(3, 9);
    expect(e.minor).toBeCloseTo(1, 9);
    expect(e.angleRad).toBeCloseTo(Math.PI / 4, 9);
  });

  it('throws on a non-positive-semidefinite covariance', () => {
    expect(() => eigenCov2({ cxx: 1, cxy: 5, cyy: 1 })).toThrow(BPlaneGeometryError);
  });
});

describe('buildBPlaneGeometry', () => {
  it('builds 1- and 3-sigma ellipses scaled from the eigenvalues', () => {
    const geom = buildBPlaneGeometry({ cxx: 4, cxy: 0, cyy: 1 }, 0.5, 0, 0.01);
    expect(geom.ellipses).toHaveLength(2);
    const oneSigma = geom.ellipses.find((e) => e.sigma === 1)!;
    const threeSigma = geom.ellipses.find((e) => e.sigma === 3)!;
    // semi-major = sigma * sqrt(major eigenvalue) = 1*2 and 3*2.
    expect(oneSigma.semiMajorKm).toBeCloseTo(2, 9);
    expect(oneSigma.semiMinorKm).toBeCloseTo(1, 9);
    expect(threeSigma.semiMajorKm).toBeCloseTo(6, 9);
    expect(threeSigma.semiMinorKm).toBeCloseTo(3, 9);
  });

  it('reports the miss magnitude and frames the plot extent', () => {
    const geom = buildBPlaneGeometry({ cxx: 1, cxy: 0, cyy: 1 }, 3, 4, 0.1);
    expect(geom.missKm).toBeCloseTo(5, 9);
    // Extent frames the 3-sigma reach (3*1) and the miss + radius (5 + 0.1), with margin.
    expect(geom.extentKm).toBeGreaterThan(5.1);
  });

  it('throws on a negative hard-body radius', () => {
    expect(() => buildBPlaneGeometry({ cxx: 1, cxy: 0, cyy: 1 }, 0, 0, -1)).toThrow(BPlaneGeometryError);
  });
});

describe('combineEncounter (two states + covariances -> 2x2 encounter plane)', () => {
  // Two objects 2 km apart along +z, both moving along +y at the same speed but the secondary
  // also drifting in +z, so the relative velocity is along +z and the encounter plane is the
  // x-y plane. The combined in-plane covariance is the sum of the two position covariances'
  // x-y blocks.
  // A diagonal inertial 3x3 position covariance (row-major length 9).
  const idCov = (cxx: number, cyy: number, czz: number): Float64Array => {
    const c = new Float64Array(9);
    c[0] = cxx;
    c[4] = cyy;
    c[8] = czz;
    return c;
  };
  it('builds the encounter plane from the relative velocity and sums the covariances', () => {
    // Secondary offset by 2 km along +x (perpendicular to the +z relative velocity), so the miss
    // lies IN the encounter plane (the plane normal to the relative velocity).
    const enc = combineEncounter(
      [7000, 0, 0, 0, 7.5, 0],
      idCov(0.01, 0.04, 0.02),
      [7002, 0, 0, 0, 7.5, 0.03],
      idCov(0.02, 0.06, 0.03),
    );
    // The 2 km cross-track separation projects nearly fully into the plane.
    expect(enc.missKm).toBeGreaterThan(1.9);
    expect(enc.relSpeedKmS).toBeCloseTo(0.03, 6);
    // The 2x2 covariance is positive (a real combined uncertainty).
    expect(enc.cov2.cxx).toBeGreaterThan(0);
    expect(enc.cov2.cyy).toBeGreaterThan(0);
  });

  it('throws on a zero relative velocity (no encounter plane)', () => {
    expect(() =>
      combineEncounter([0, 0, 0, 0, 7.5, 0], idCov(1, 1, 1), [0, 0, 2, 0, 7.5, 0], idCov(1, 1, 1)),
    ).toThrow();
  });
});

describe('ellipsePoints', () => {
  it('samples a closed outline whose points lie on the (rotated) ellipse', () => {
    const pts = ellipsePoints(2, 1, 0, 0, 0, 16);
    expect(pts).toHaveLength(16);
    // Every point satisfies (x/2)^2 + (y/1)^2 = 1 for the axis-aligned ellipse.
    for (const [x, y] of pts) {
      expect((x / 2) ** 2 + (y / 1) ** 2).toBeCloseTo(1, 9);
    }
  });

  it('translates the outline to a center', () => {
    const pts = ellipsePoints(1, 1, 0, 5, -3, 8);
    // The centroid of a symmetric sampling is the center.
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    expect(cx).toBeCloseTo(5, 9);
    expect(cy).toBeCloseTo(-3, 9);
  });
});
