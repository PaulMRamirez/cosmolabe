// Tropospheric refraction. Independent oracles (not circular):
//   (1) the Bennett refraction angle matches the standard tabulated values: ~34 arcmin at the
//       horizon, ~5.4 arcmin (1.57 mrad) at 10 deg, ~1 arcmin at 45 deg, ~0 at the zenith.
//       These are hand-computed reference numbers, not taken from the module.
//   (2) turning refraction on in an azel measurement raises the predicted elevation by exactly
//       that Bennett angle (a milliradian-scale shift) and leaves the azimuth untouched.
//   (3) the refraction-corrected elevation partial (with the 1 + dR/del chain factor) matches a
//       central finite difference of the predicted elevation.
//   (4) site pressure/temperature scale the correction the documented way (denser air bends more).
// References: Bennett 1982 (J. Navigation 35:255); Vallado section 4.4. (STK-class OD.)

import { describe, expect, it } from 'vitest';
import { bennettRefraction } from './refraction.ts';
import { predict } from './measurements.ts';
import type { AnglesMeasurement } from './types.ts';

const DEG = Math.PI / 180;
const ARCMIN = DEG / 60;

describe('Bennett tropospheric refraction', () => {
  it('matches standard tabulated refraction values across elevation', () => {
    // Standard sea-level refraction (arcmin): horizon ~34', 10 deg ~5.4', 45 deg ~1', zenith ~0'.
    expect(bennettRefraction(0) / ARCMIN).toBeGreaterThan(30);
    expect(bennettRefraction(0) / ARCMIN).toBeLessThan(40);
    expect(bennettRefraction(10 * DEG) / ARCMIN).toBeCloseTo(5.39, 1); // ~1.57 mrad
    expect(bennettRefraction(45 * DEG) / ARCMIN).toBeCloseTo(0.99, 1);
    expect(bennettRefraction(90 * DEG) / ARCMIN).toBeLessThan(0.01);
  });

  it('is positive and monotonically decreasing with elevation', () => {
    let prev = Infinity;
    for (let elDeg = 1; elDeg <= 90; elDeg += 1) {
      const r = bennettRefraction(elDeg * DEG);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('scales up with site pressure and down with temperature (denser air bends more)', () => {
    const base = bennettRefraction(10 * DEG);
    const highP = bennettRefraction(10 * DEG, { pressureMbar: 1050 });
    const hotT = bennettRefraction(10 * DEG, { temperatureK: 310 });
    expect(highP).toBeGreaterThan(base);
    expect(hotT).toBeLessThan(base);
  });
});

// A station looking at a target a known geometric elevation above the horizon. We place the
// target along a line of sight whose elevation in the local ENU frame is a chosen angle.
function azelMeasurement(elGeomDeg: number, refraction: AnglesMeasurement['refraction']): {
  m: AnglesMeasurement;
  state: Float64Array;
} {
  const observer: [number, number, number] = [6378, 0, 0];
  // Local ENU at the observer (on the +X axis): up = +X, north = +Z, east = +Y.
  const up: [number, number, number] = [1, 0, 0];
  const north: [number, number, number] = [0, 0, 1];
  const east: [number, number, number] = [0, 1, 0];
  // A line of sight at elevation elGeom, azimuth 0 (due north): rho = cos(el)*north + sin(el)*up.
  const el = elGeomDeg * DEG;
  const rng = 2000;
  const rho: [number, number, number] = [
    rng * (Math.cos(el) * north[0] + Math.sin(el) * up[0]),
    rng * (Math.cos(el) * north[1] + Math.sin(el) * up[1]),
    rng * (Math.cos(el) * north[2] + Math.sin(el) * up[2]),
  ];
  const state = Float64Array.of(observer[0] + rho[0], observer[1] + rho[1], observer[2] + rho[2], 0, 0, 0);
  const m: AnglesMeasurement = {
    kind: 'angles',
    frame: 'azel',
    epoch: 0,
    observer,
    sigma: [1e-5, 1e-5],
    value: [0, el],
    enu: { east, north, up },
    refraction,
  };
  return { m, state };
}

describe('azel measurement with refraction', () => {
  it('raises the predicted elevation by the Bennett angle and leaves azimuth unchanged', () => {
    const elGeomDeg = 10;
    const { m: mOff, state } = azelMeasurement(elGeomDeg, false);
    const { m: mOn } = azelMeasurement(elGeomDeg, true);
    const off = predict(mOff, state);
    const on = predict(mOn, state);
    const elOff = off.value[1]!;
    const elOn = on.value[1]!;
    const expectedShift = bennettRefraction(elOff); // ~1.57 mrad at 10 deg
    expect(elOn - elOff).toBeCloseTo(expectedShift, 9);
    expect(elOn - elOff).toBeGreaterThan(1e-3); // a milliradian-scale shift
    // Azimuth is unaffected by vertical refraction.
    expect(on.value[0]!).toBeCloseTo(off.value[0]!, 12);
  });

  it('refraction-corrected elevation partial matches a central finite difference', () => {
    const { m, state } = azelMeasurement(15, true);
    const pred = predict(m, state);
    const h = 1e-3; // km
    for (let j = 0; j < 3; j++) {
      const sp = Float64Array.from(state);
      const sm = Float64Array.from(state);
      sp[j]! += h;
      sm[j]! -= h;
      const elP = predict(m, sp).value[1]!;
      const elM = predict(m, sm).value[1]!;
      const fd = (elP - elM) / (2 * h);
      expect(pred.jac[6 + j]!).toBeCloseTo(fd, 6); // elevation row of the 2x6 Jacobian
    }
  });
});
