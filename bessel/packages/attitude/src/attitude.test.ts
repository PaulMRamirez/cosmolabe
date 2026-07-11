// Eigen-axis slew kinematics (pure) and two-vector pointing (CSPICE twovec +
// geometry from the de440/Cassini fixtures). (STK_PARITY_SPEC §4.6.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { eigenAxisSlew, slerp, nadirAttitude, type Quaternion } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

const IDENTITY: Quaternion = [1, 0, 0, 0];
// 90 deg about +Z.
const Z90: Quaternion = [Math.cos(Math.PI / 4), 0, 0, Math.sin(Math.PI / 4)];

describe('eigenAxisSlew', () => {
  it('spans exactly the angle between the orientations', () => {
    const s = eigenAxisSlew(IDENTITY, Z90, 0.02, 0.005);
    expect(s.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(s.duration).toBeGreaterThan(0);
  });

  it('starts at the from orientation and ends at the to orientation', () => {
    const s = eigenAxisSlew(IDENTITY, Z90, 0.02, 0.005);
    for (let i = 0; i < 4; i++) {
      expect(s.at(0)[i]).toBeCloseTo(IDENTITY[i]!, 6);
      expect(s.at(s.duration)[i]).toBeCloseTo(Z90[i]!, 6);
    }
  });

  it('progresses monotonically through the slew', () => {
    const s = eigenAxisSlew(IDENTITY, Z90, 0.02, 0.005);
    const frac = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q[0]))); // angle from identity
    let prev = -1;
    for (let t = 0; t <= s.duration; t += s.duration / 20) {
      const f = frac(s.at(t));
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
  });

  it('uses a triangular profile when the max rate is never reached', () => {
    // High max rate so the slew is accel/decel only: duration = 2*sqrt(angle/accel).
    const accel = 0.01;
    const s = eigenAxisSlew(IDENTITY, Z90, 10, accel);
    expect(s.duration).toBeCloseTo(2 * Math.sqrt(s.angle / accel), 6);
  });

  it('slerp midpoint halves the rotation angle', () => {
    const mid = slerp(IDENTITY, Z90, 0.5);
    expect(2 * Math.acos(Math.min(1, Math.abs(mid[0])))).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('nadirAttitude (twovec)', () => {
  let spice: SpiceEngine;
  let et: number;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp', 'cassini-soi.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
    et = await spice.str2et('2004-07-01T02:00:00');
  });

  it('points the primary body axis along the nadir direction', async () => {
    const m = await nadirAttitude(spice, '-82', 'SATURN', et, { primaryAxis: 3, secondaryAxis: 1 });
    // M maps J2000 -> body; row 2 (0-based) is body +Z expressed in J2000 == nadir.
    const toBody = await spice.spkpos('SATURN', et, 'J2000', 'NONE', '-82');
    const nadir = toBody.position;
    const norm = Math.hypot(nadir.x, nadir.y, nadir.z);
    expect(m[6]!).toBeCloseTo(nadir.x / norm, 6);
    expect(m[7]!).toBeCloseTo(nadir.y / norm, 6);
    expect(m[8]!).toBeCloseTo(nadir.z / norm, 6);
  });
});
