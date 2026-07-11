// CCSDS Orbit Mean-elements Message (OMM, KVN form; CCSDS 502.0-B) parser, the modern
// interchange format for SGP4 mean elements (the structured successor to the TLE). It
// carries the same elements as a TLE, so ommToTle adapts it straight into sgp4init.
// Pure and headless; fails loudly. (STK_PARITY_SPEC §4.11.)

import type { Tle } from './tle.ts';

export interface Omm {
  readonly objectName?: string;
  readonly objectId?: string;
  readonly noradCatId: number;
  readonly centerName?: string;
  readonly refFrame?: string;
  readonly meanElementTheory?: string;
  /** Epoch as written (UTC ISO unless the time system says otherwise). */
  readonly epoch: string;
  readonly meanMotion: number; // rev/day
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  readonly raanDeg: number;
  readonly argpDeg: number;
  readonly meanAnomalyDeg: number;
  readonly bstar: number;
  readonly meanMotionDot: number;
  readonly meanMotionDdot: number;
  readonly elementSetNo?: number;
  readonly revAtEpoch?: number;
}

export class OmmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmmError';
  }
}

/** Parse the KEYWORD = VALUE pairs of a KVN document into a map (skips comments). */
function kvnPairs(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('COMMENT') || line.endsWith('_START') || line.endsWith('_STOP')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return map;
}

function num(map: Map<string, string>, key: string, fallback?: number): number {
  const raw = map.get(key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new OmmError(`OMM missing required keyword ${key}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new OmmError(`OMM keyword ${key} is not numeric: "${raw}"`);
  return n;
}

/** Parse a CCSDS OMM (KVN) document. */
export function parseOmm(text: string): Omm {
  const map = kvnPairs(text);
  if (!map.has('CCSDS_OMM_VERS')) throw new OmmError('not a CCSDS OMM (missing CCSDS_OMM_VERS)');
  const epoch = map.get('EPOCH');
  if (!epoch) throw new OmmError('OMM missing required keyword EPOCH');
  return {
    ...(map.get('OBJECT_NAME') !== undefined ? { objectName: map.get('OBJECT_NAME')! } : {}),
    ...(map.get('OBJECT_ID') !== undefined ? { objectId: map.get('OBJECT_ID')! } : {}),
    noradCatId: num(map, 'NORAD_CAT_ID', 0),
    ...(map.get('CENTER_NAME') !== undefined ? { centerName: map.get('CENTER_NAME')! } : {}),
    ...(map.get('REF_FRAME') !== undefined ? { refFrame: map.get('REF_FRAME')! } : {}),
    ...(map.get('MEAN_ELEMENT_THEORY') !== undefined ? { meanElementTheory: map.get('MEAN_ELEMENT_THEORY')! } : {}),
    epoch,
    meanMotion: num(map, 'MEAN_MOTION'),
    eccentricity: num(map, 'ECCENTRICITY'),
    inclinationDeg: num(map, 'INCLINATION'),
    raanDeg: num(map, 'RA_OF_ASC_NODE'),
    argpDeg: num(map, 'ARG_OF_PERICENTER'),
    meanAnomalyDeg: num(map, 'MEAN_ANOMALY'),
    bstar: num(map, 'BSTAR', 0),
    meanMotionDot: num(map, 'MEAN_MOTION_DOT', 0),
    meanMotionDdot: num(map, 'MEAN_MOTION_DDOT', 0),
    ...(map.has('ELEMENT_SET_NO') ? { elementSetNo: num(map, 'ELEMENT_SET_NO') } : {}),
    ...(map.has('REV_AT_EPOCH') ? { revAtEpoch: num(map, 'REV_AT_EPOCH') } : {}),
  };
}

const DEG = Math.PI / 180;

/**
 * Adapt an OMM into the Tle structure sgp4init consumes (same mean elements, angles in
 * radians, mean motion in rev/day). The OMM EPOCH (ISO, possibly with a trailing Z) is
 * carried through as epochUtc.
 */
export function ommToTle(omm: Omm): Tle {
  return {
    satnum: omm.noradCatId,
    epochUtc: omm.epoch.endsWith('Z') ? omm.epoch : `${omm.epoch}Z`,
    inclination: omm.inclinationDeg * DEG,
    raan: omm.raanDeg * DEG,
    eccentricity: omm.eccentricity,
    argp: omm.argpDeg * DEG,
    meanAnomaly: omm.meanAnomalyDeg * DEG,
    meanMotion: omm.meanMotion,
    ndot: omm.meanMotionDot,
    nddot: omm.meanMotionDdot,
    bstar: omm.bstar,
  };
}
