// SGP4 validated against the canonical AIAA-2006-6753 SGP4-VER catalog-5 reference
// state vectors (TEME), the gold standard for SGP4 conformance. (STK_PARITY_SPEC PROP-4.)

import { describe, it, expect } from 'vitest';
import { parseTle } from './tle.ts';
import { sgp4init, sgp4 } from './sgp4.ts';

const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

// SGP4-VER tcppver.out reference records for satellite 5 (km, km/s, TEME).
const REFERENCE: { t: number; r: [number, number, number]; v: [number, number, number] }[] = [
  { t: 0, r: [7022.46529266, -1400.08296755, 0.03995155], v: [1.893841015, 6.405893759, 4.53480725] },
  { t: 360, r: [-7154.03120202, -3783.17682504, -3536.19412294], v: [4.741887409, -4.151817765, -2.093935425] },
  { t: 720, r: [-7134.59340119, 6531.68641334, 3260.27186483], v: [-4.113793027, -2.911922039, -2.557327851] },
];

describe('sgp4 (catalog 5, SGP4-VER)', () => {
  const rec = sgp4init(parseTle(L1, L2));

  for (const ref of REFERENCE) {
    it(`matches the reference TEME state at tsince = ${ref.t} min`, () => {
      const s = sgp4(rec, ref.t);
      for (let i = 0; i < 3; i++) {
        expect(s.position[i]).toBeCloseTo(ref.r[i]!, 4); // sub-meter agreement
        expect(s.velocity[i]).toBeCloseTo(ref.v[i]!, 6);
      }
    });
  }
});
