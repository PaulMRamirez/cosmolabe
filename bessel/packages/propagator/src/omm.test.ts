// OMM parsing and the OMM -> TLE adapter: an OMM built from the SGP4-VER catalog-5
// elements must reproduce the TLE's parsed elements and the same SGP4 state, proving
// OMM is a drop-in modern replacement for the TLE. (STK_PARITY_SPEC §4.11.)

import { describe, it, expect } from 'vitest';
import { parseOmm, ommToTle, OmmError } from './omm.ts';
import { parseTle } from './tle.ts';
import { sgp4init, sgp4 } from './sgp4.ts';

const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

// The same satellite-5 elements expressed as a CCSDS OMM (KVN).
const OMM = `CCSDS_OMM_VERS = 2.0
CREATION_DATE = 2000-06-28T00:00:00
ORIGINATOR = TEST

META_START
OBJECT_NAME = VANGUARD
OBJECT_ID = 1958-002B
CENTER_NAME = EARTH
REF_FRAME = TEME
TIME_SYSTEM = UTC
MEAN_ELEMENT_THEORY = SGP4
META_STOP

EPOCH = 2000-06-28T18:50:19.733
MEAN_MOTION = 10.82419157
ECCENTRICITY = 0.1859667
INCLINATION = 34.2682
RA_OF_ASC_NODE = 348.7242
ARG_OF_PERICENTER = 331.7664
MEAN_ANOMALY = 19.3264
NORAD_CAT_ID = 5
ELEMENT_SET_NO = 475
BSTAR = 0.000028098
MEAN_MOTION_DOT = 0.00000023
MEAN_MOTION_DDOT = 0
`;

describe('parseOmm / ommToTle', () => {
  it('parses the OMM metadata and mean elements', () => {
    const omm = parseOmm(OMM);
    expect(omm.objectName).toBe('VANGUARD');
    expect(omm.noradCatId).toBe(5);
    expect(omm.meanElementTheory).toBe('SGP4');
    expect(omm.meanMotion).toBeCloseTo(10.82419157, 8);
    expect(omm.inclinationDeg).toBeCloseTo(34.2682, 4);
  });

  it('adapts to a TLE whose elements match the parsed TLE', () => {
    const fromOmm = ommToTle(parseOmm(OMM));
    const fromTle = parseTle(L1, L2);
    expect(fromOmm.satnum).toBe(fromTle.satnum);
    expect(fromOmm.inclination).toBeCloseTo(fromTle.inclination, 6);
    expect(fromOmm.raan).toBeCloseTo(fromTle.raan, 6);
    expect(fromOmm.eccentricity).toBeCloseTo(fromTle.eccentricity, 7);
    expect(fromOmm.argp).toBeCloseTo(fromTle.argp, 6);
    expect(fromOmm.meanAnomaly).toBeCloseTo(fromTle.meanAnomaly, 6);
    expect(fromOmm.meanMotion).toBeCloseTo(fromTle.meanMotion, 8);
  });

  it('produces the same SGP4 state as the TLE at epoch', () => {
    const a = sgp4(sgp4init(ommToTle(parseOmm(OMM))), 0);
    const b = sgp4(sgp4init(parseTle(L1, L2)), 0);
    for (let i = 0; i < 3; i++) {
      expect(a.position[i]).toBeCloseTo(b.position[i]!, 6);
      expect(a.velocity[i]).toBeCloseTo(b.velocity[i]!, 6);
    }
  });

  it('rejects a non-OMM document', () => {
    expect(() => parseOmm('FOO = 1')).toThrow(OmmError);
  });
});
