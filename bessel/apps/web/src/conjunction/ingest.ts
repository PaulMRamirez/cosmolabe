// Real CDM/OEM/TLE ingestion into a conjunction screening catalog (analysis-UX Phase 1,
// decision 3). Pure and SPICE-free: each format's text is parsed by the existing REAL
// parsers (@bessel/interop parseCdm/parseOem, @bessel/propagator parseTle + SGP4), then
// sampled onto one shared epoch grid into the SampledEphemeris shape screenAllVsAll
// requires, plus the per-object 6-state and 6x6 covariance the per-event full-covariance
// Pc needs (CDM carries covariances; OEM/TLE give ephemerides). Fails loud with a located
// typed error on malformed input.
//
// Time base: the shared grid is expressed in UTC seconds-since-the-Unix-epoch, derived by
// parsing each format's ISO epoch string (Date.parse of a fixed input, not the wall clock,
// so the function stays deterministic). The screen only needs a consistent strictly-ascending
// grid shared across objects, not a SPICE ET, so this avoids a SPICE round-trip in the
// pure ingestion path. (The grid is internally consistent; it is not handed to SPICE.)

import { parseCdm, parseOem, type Oem } from '@bessel/interop';
import { parseTle, sgp4init, sgp4 } from '@bessel/propagator';
import type { SampledEphemeris } from '@bessel/conjunction';

/** The ingestion formats the catalog card accepts. */
export type IngestFormat = 'cdm' | 'oem' | 'tle';

/** A loud, located ingestion error (malformed input or an unusable catalog). */
export class IngestError extends Error {
  constructor(message: string) {
    super(`conjunction ingest: ${message}`);
    this.name = 'IngestError';
  }
}

/** Per-object 6-state + inertial 3x3 position covariance carried alongside an ingested object,
 *  for the per-event full-covariance Pc. The full-covariance Pc combines the two objects'
 *  position covariances in the encounter plane, so only the inertial 3x3 position block is
 *  needed (the velocity covariance does not enter the short-arc encounter-plane reduction).
 *  Present only when the source format carries a covariance (CDM); OEM/TLE objects have no entry,
 *  and the per-event card then falls back to the max-Pc bound. */
export interface IngestedCovariance {
  /** 6-state [x,y,z,vx,vy,vz] (km, km/s) at the object's reference epoch (the CDM TCA). */
  readonly state6: Float64Array;
  /** Inertial 3x3 position covariance (km^2), row-major length 9 (rotated from the CDM RTN block). */
  readonly posCov3: Float64Array;
}

/** The result of one ingestion: the screening catalog plus per-object covariance (by id). */
export interface IngestResult {
  /** The objects sampled onto one shared grid, ready for screenAllVsAll. */
  readonly catalog: SampledEphemeris[];
  /** Per-object inertial 6-state + 6x6 covariance, keyed by SampledEphemeris.id; an entry
   *  is present only when the source carried a covariance (CDM). */
  readonly covariances: ReadonlyMap<string, IngestedCovariance>;
  /** The ingested format (echoed for the panel readout). */
  readonly format: IngestFormat;
  /** The shared grid epoch (UTC seconds) the catalog starts at. */
  readonly epoch: number;
  /** A short human note (object count, covariance count) for the panel readout. */
  readonly note: string;
}

/** Default sampling: a forward window and sample count for the OEM/TLE ephemeris grid. */
export interface IngestOptions {
  /** Window span (seconds) the shared grid covers. */
  readonly spanSec?: number;
  /** Number of strictly-ascending grid samples (>= 2). */
  readonly steps?: number;
  /** Default per-axis position sigma (km) tagged on each object for the 2D screen Pc when
   *  the source carries no full covariance; the per-event card uses the real CDM covariance. */
  readonly defaultSigmaKm?: number;
  /** Default hard-body radius (km) tagged on each object for the screen Pc. */
  readonly defaultRadiusKm?: number;
}

export const INGEST_DEFAULTS = {
  spanSec: 5400,
  steps: 600,
  defaultSigmaKm: 0.5,
  defaultRadiusKm: 0.01,
} as const;

/** Parse an ISO UTC epoch string to seconds since the Unix epoch. Deterministic (parses a
 *  fixed input, not the wall clock). Throws a located IngestError on an unparseable epoch. */
function isoToUnixSeconds(iso: string): number {
  const trimmed = iso.trim();
  const ms = Date.parse(trimmed.endsWith('Z') ? trimmed : `${trimmed}Z`);
  if (!Number.isFinite(ms)) throw new IngestError(`unparseable epoch "${iso}"`);
  return ms / 1000;
}

/** Build a strictly-ascending shared grid of `steps` UTC-second samples from `epoch`. */
function buildGrid(epoch: number, spanSec: number, steps: number): Float64Array {
  const n = Math.max(2, Math.floor(steps));
  const grid = new Float64Array(n);
  for (let k = 0; k < n; k++) grid[k] = epoch + (spanSec * k) / (n - 1);
  return grid;
}

/** Linear interpolation of a tabulated state series onto a target epoch. The OEM is a coarse
 *  ephemeris; for screening a linear blend between bracketing states is adequate (the screen
 *  refines TCA from the sampled grid). Returns position + velocity. */
function interpState(
  epochs: readonly number[],
  pos: readonly (readonly [number, number, number])[],
  vel: readonly (readonly [number, number, number])[],
  t: number,
): { p: readonly [number, number, number]; v: readonly [number, number, number] } {
  const n = epochs.length;
  if (t <= epochs[0]!) return { p: pos[0]!, v: vel[0]! };
  if (t >= epochs[n - 1]!) return { p: pos[n - 1]!, v: vel[n - 1]! };
  let i = 0;
  while (i < n - 1 && epochs[i + 1]! < t) i++;
  const t0 = epochs[i]!;
  const t1 = epochs[i + 1]!;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const lerp3 = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): [number, number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  return { p: lerp3(pos[i]!, pos[i + 1]!), v: lerp3(vel[i]!, vel[i + 1]!) };
}

/** Sample one OEM onto the shared grid into a SampledEphemeris. */
function sampleOem(oem: Oem, grid: Float64Array, opts: Required<IngestOptions>): SampledEphemeris {
  const epochs = oem.states.map((s) => isoToUnixSeconds(s.epoch));
  const posArr = oem.states.map((s) => s.position);
  const velArr = oem.states.map((s) => s.velocity);
  const n = grid.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const { p, v } = interpState(epochs, posArr, velArr, grid[k]!);
    pos[k * 3] = p[0]!;
    pos[k * 3 + 1] = p[1]!;
    pos[k * 3 + 2] = p[2]!;
    vel[k * 3] = v[0]!;
    vel[k * 3 + 1] = v[1]!;
    vel[k * 3 + 2] = v[2]!;
  }
  const id = oem.metadata.objectName ?? oem.metadata.objectId ?? `OEM-${epochs[0]!.toFixed(0)}`;
  return { id, et: grid, pos, vel, radiusKm: opts.defaultRadiusKm, sigmaKm: opts.defaultSigmaKm };
}

/** SGP4-sample one TLE onto the shared grid into a SampledEphemeris. The TEME->J2000 frame
 *  difference is an arcminute-scale approximation near the epoch (same caveat the existing
 *  TLE propagation op documents); for screening geometry it is adequate. */
function sampleTle(
  line1: string,
  line2: string,
  grid: Float64Array,
  opts: Required<IngestOptions>,
  name?: string,
): SampledEphemeris {
  const tle = parseTle(line1, line2);
  const rec = sgp4init(tle);
  const epoch = isoToUnixSeconds(tle.epochUtc);
  const n = grid.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const s = sgp4(rec, (grid[k]! - epoch) / 60); // SGP4 tsince is in minutes
    pos[k * 3] = s.position[0];
    pos[k * 3 + 1] = s.position[1];
    pos[k * 3 + 2] = s.position[2];
    vel[k * 3] = s.velocity[0];
    vel[k * 3 + 1] = s.velocity[1];
    vel[k * 3 + 2] = s.velocity[2];
  }
  const id = name && name.trim() !== '' ? name.trim() : `TLE-${tle.satnum}`;
  return { id, et: grid, pos, vel, radiusKm: opts.defaultRadiusKm, sigmaKm: opts.defaultSigmaKm };
}

// CDM ingestion. The shared parseCdm gives the relative summary (TCA / miss / designators);
// a full CCSDS 508.0 CDM also carries each object's inertial state vector (X/Y/Z/X_DOT/...)
// and an RTN (radial/transverse/normal) covariance block (CR_R, CT_R, CT_T, ...). The state
// and the RTN position-block covariance are parsed here (co-located; the shared parser is
// untouched) into the per-object inertial 6-state + inertial 3x3 position covariance the
// encounter-plane Pc needs (the velocity covariance does not enter the short-arc reduction).

/** One CDM object's parsed inertial state + RTN position covariance. */
interface CdmObjectState {
  readonly id: string;
  /** Inertial 6-state [x,y,z,vx,vy,vz] (km, km/s). */
  readonly state6: Float64Array;
  /** RTN 3x3 position covariance, row-major length 9, or null when absent/incomplete. */
  readonly rtnPosCov3: Float64Array | null;
}

/** Parse the numeric value of a KVN line, stripping a trailing "[unit]" annotation. */
function kvnNumber(raw: string, key: string): number {
  const v = raw.replace(/\[.*\]\s*$/, '').trim();
  const n = Number(v);
  if (!Number.isFinite(n)) throw new IngestError(`CDM field ${key} is not numeric: "${raw}"`);
  return n;
}

// The RTN position-block covariance keys (CCSDS 508.0 lower triangle) mapped to (row, col) in
// the 3x3 [R, T, N] ordering. The CDM writes the lower triangle; we mirror it to the upper.
const CDM_COV_KEYS: readonly (readonly [string, number, number])[] = [
  ['CR_R', 0, 0],
  ['CT_R', 1, 0], ['CT_T', 1, 1],
  ['CN_R', 2, 0], ['CN_T', 2, 1], ['CN_N', 2, 2],
];

const STATE_KEYS: Record<string, number> = { X: 0, Y: 1, Z: 2, X_DOT: 3, Y_DOT: 4, Z_DOT: 5 };

/**
 * Parse each CDM object's state vector and RTN position covariance from the KVN body, walking
 * the OBJECT blocks. The relative summary is read separately by the shared parseCdm. A CDM state
 * vector is in km (KM, KM/S per 508.0); the RTN covariance is km^2. Returns one entry per OBJECT.
 */
function parseCdmObjectStates(text: string): CdmObjectState[] {
  interface Acc {
    id: string;
    state: Float64Array;
    haveState: boolean[];
    cov: Float64Array;
    haveCov: boolean;
  }
  const objects: Acc[] = [];
  let current: Acc | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('COMMENT')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'OBJECT' && /^OBJECT[12]$/.test(value)) {
      current = {
        id: value,
        state: new Float64Array(6),
        haveState: [false, false, false, false, false, false],
        cov: new Float64Array(9),
        haveCov: false,
      };
      objects.push(current);
      continue;
    }
    if (!current) continue;
    if (key === 'OBJECT_DESIGNATOR') {
      current.id = value;
      continue;
    }
    if (key in STATE_KEYS) {
      const i = STATE_KEYS[key]!;
      current.state[i] = kvnNumber(value, key);
      current.haveState[i] = true;
      continue;
    }
    for (const [covKey, r, c] of CDM_COV_KEYS) {
      if (key === covKey) {
        const v = kvnNumber(value, key);
        current.cov[r * 3 + c] = v;
        current.cov[c * 3 + r] = v; // mirror to the upper triangle
        current.haveCov = true;
        break;
      }
    }
  }
  return objects.map((o) => ({
    id: o.id,
    state6: o.state,
    rtnPosCov3: o.haveCov && o.haveState.every(Boolean) ? o.cov : null,
  }));
}

/** Build the RTN->inertial 3x3 rotation (columns: radial, transverse, normal unit vectors)
 *  from an inertial position/velocity. Radial = r-hat, normal = (r x v)-hat, transverse =
 *  normal x radial. Throws loud on a degenerate (zero |r| or parallel r,v) state. */
function rtnToInertialRotation(state6: Float64Array): Float64Array {
  const rx = state6[0]!, ry = state6[1]!, rz = state6[2]!;
  const vx = state6[3]!, vy = state6[4]!, vz = state6[5]!;
  const rMag = Math.hypot(rx, ry, rz);
  if (rMag <= 0) throw new IngestError('CDM object has a zero position vector');
  const R = [rx / rMag, ry / rMag, rz / rMag] as const;
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.hypot(hx, hy, hz);
  if (hMag <= 0) throw new IngestError('CDM object has parallel position and velocity (no orbit plane)');
  const N = [hx / hMag, hy / hMag, hz / hMag] as const;
  const T = [
    N[1] * R[2] - N[2] * R[1],
    N[2] * R[0] - N[0] * R[2],
    N[0] * R[1] - N[1] * R[0],
  ] as const;
  // Columns are R, T, N expressed in inertial coordinates (row-major 3x3).
  return Float64Array.of(R[0], T[0], N[0], R[1], T[1], N[1], R[2], T[2], N[2]);
}

/** Rotate an RTN 3x3 covariance into the inertial frame: C_in = M C_rtn M^T, with M the 3x3
 *  RTN->inertial rotation. Row-major length-9 in and out. */
function rtnPosCovToInertial(rtnCov: Float64Array, m: Float64Array): Float64Array {
  // mC = M C, then C_in = mC M^T.
  const mC = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[i * 3 + k]! * rtnCov[k * 3 + j]!;
      mC[i * 3 + j] = s;
    }
  const out = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += mC[i * 3 + k]! * m[j * 3 + k]!; // M^T -> m[j][k]
      out[i * 3 + j] = s;
    }
  return out;
}

/**
 * Sample a CDM object onto the shared grid by rectilinear coasting from its reference state.
 * A CDM carries one state per object; the SCREEN needs a sampled ephemeris that brackets the
 * close approach, and the per-event card re-propagates with two-body dynamics for the Pc, so
 * a constant-velocity sampling across the short grid is sufficient to localize TCA.
 */
function sampleCdmObject(obj: CdmObjectState, grid: Float64Array, refEpoch: number, opts: Required<IngestOptions>): SampledEphemeris {
  const n = grid.length;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  const px = obj.state6[0]!, py = obj.state6[1]!, pz = obj.state6[2]!;
  const vx = obj.state6[3]!, vy = obj.state6[4]!, vz = obj.state6[5]!;
  for (let k = 0; k < n; k++) {
    const dt = grid[k]! - refEpoch;
    pos[k * 3] = px + vx * dt;
    pos[k * 3 + 1] = py + vy * dt;
    pos[k * 3 + 2] = pz + vz * dt;
    vel[k * 3] = vx;
    vel[k * 3 + 1] = vy;
    vel[k * 3 + 2] = vz;
  }
  return { id: obj.id, et: grid, pos, vel, radiusKm: opts.defaultRadiusKm, sigmaKm: opts.defaultSigmaKm };
}

/** Split a pasted TLE set into name/line1/line2 triples (or pairs without a name line). */
function splitTleSet(text: string): { name?: string; line1: string; line2: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  const out: { name?: string; line1: string; line2: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('1 ')) {
      const l2 = lines[i + 1];
      if (l2 === undefined || !l2.startsWith('2 ')) throw new IngestError(`TLE line 1 at row ${i} has no matching line 2`);
      out.push({ line1: l, line2: l2 });
      i += 2;
    } else if (!l.startsWith('2 ')) {
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      if (l1 === undefined || !l1.startsWith('1 ')) throw new IngestError(`expected a TLE line 1 after name "${l}" (row ${i})`);
      if (l2 === undefined || !l2.startsWith('2 ')) throw new IngestError(`expected a TLE line 2 after line 1 (row ${i + 1})`);
      out.push({ name: l, line1: l1, line2: l2 });
      i += 3;
    } else {
      throw new IngestError(`unexpected TLE line 2 without a line 1 at row ${i}`);
    }
  }
  return out;
}

/** Split a pasted multi-document text on a CCSDS version header into one chunk per document. */
function splitOnHeader(text: string, header: string): string[] {
  const re = new RegExp(`^\\s*${header}\\b`);
  const lines = text.split(/\r?\n/);
  const offsets: number[] = [];
  let off = 0;
  for (const line of lines) {
    if (re.test(line)) offsets.push(off);
    off += line.length + 1;
  }
  if (offsets.length <= 1) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i]!;
    const end = i + 1 < offsets.length ? offsets[i + 1]! : text.length;
    chunks.push(text.slice(start, end));
  }
  return chunks;
}

/** screenAllVsAll keys results by object id; duplicate ids would make events ambiguous. */
function assertUniqueIds(catalog: readonly SampledEphemeris[]): void {
  const seen = new Set<string>();
  for (const o of catalog) {
    if (seen.has(o.id)) throw new IngestError(`duplicate object id "${o.id}" in the ingested catalog`);
    seen.add(o.id);
  }
}

/**
 * Ingest pasted/uploaded text in the given format into a screening catalog. REAL parsing:
 * CDM via parseCdm + the co-located state/covariance parse, OEM via parseOem, TLE via parseTle
 * + SGP4. Every object is sampled onto one shared grid (so screenAllVsAll's shared-grid
 * assertion holds), and CDM objects additionally carry their inertial 6-state + 6x6 covariance
 * for the per-event full-covariance Pc. Fails loud (IngestError) on malformed or unusable input.
 */
export function ingestCatalog(format: IngestFormat, text: string, options: IngestOptions = {}): IngestResult {
  const opts: Required<IngestOptions> = {
    spanSec: options.spanSec ?? INGEST_DEFAULTS.spanSec,
    steps: options.steps ?? INGEST_DEFAULTS.steps,
    defaultSigmaKm: options.defaultSigmaKm ?? INGEST_DEFAULTS.defaultSigmaKm,
    defaultRadiusKm: options.defaultRadiusKm ?? INGEST_DEFAULTS.defaultRadiusKm,
  };
  if (text.trim() === '') throw new IngestError('input is empty');

  const covariances = new Map<string, IngestedCovariance>();

  if (format === 'tle') {
    const set = splitTleSet(text);
    if (set.length < 2) throw new IngestError(`a TLE set needs at least 2 objects to screen (got ${set.length})`);
    const epoch = Math.min(...set.map((t) => isoToUnixSeconds(parseTle(t.line1, t.line2).epochUtc)));
    const grid = buildGrid(epoch, opts.spanSec, opts.steps);
    const catalog = set.map((t) => sampleTle(t.line1, t.line2, grid, opts, t.name));
    assertUniqueIds(catalog);
    return { catalog, covariances, format, epoch, note: `${catalog.length} TLE objects, 0 with covariance` };
  }

  if (format === 'oem') {
    const chunks = splitOnHeader(text, 'CCSDS_OEM_VERS');
    const oems = chunks.map((c) => parseOem(c));
    if (oems.length < 2) throw new IngestError(`need at least 2 OEM segments to screen (got ${oems.length})`);
    const epoch = Math.min(...oems.map((o) => isoToUnixSeconds(o.states[0]!.epoch)));
    const grid = buildGrid(epoch, opts.spanSec, opts.steps);
    const catalog = oems.map((o) => sampleOem(o, grid, opts));
    assertUniqueIds(catalog);
    return { catalog, covariances, format, epoch, note: `${catalog.length} OEM objects, 0 with covariance` };
  }

  // CDM: the relative summary via the shared parser (fails loud on a non-CDM), plus the
  // co-located object state/covariance parse. One CDM yields the primary/secondary pair.
  const summary = parseCdm(text);
  const objStates = parseCdmObjectStates(text);
  const withState = objStates.filter((o) => o.state6.some((v) => v !== 0));
  if (withState.length < 2) {
    throw new IngestError(
      'CDM has no inertial object state vectors (X/Y/Z/X_DOT/...); cannot build a screening catalog. ' +
        `Relative summary parsed: miss ${summary.missDistanceM} m at TCA ${summary.tca}.`,
    );
  }
  const tcaEpoch = isoToUnixSeconds(summary.tca);
  // Center the grid on the TCA so the close approach is bracketed.
  const start = tcaEpoch - opts.spanSec / 2;
  const grid = buildGrid(start, opts.spanSec, opts.steps);
  const catalog = withState.map((o) => sampleCdmObject(o, grid, tcaEpoch, opts));
  assertUniqueIds(catalog);
  let covCount = 0;
  for (const o of withState) {
    if (o.rtnPosCov3) {
      const rot = rtnToInertialRotation(o.state6);
      const posCov3 = rtnPosCovToInertial(o.rtnPosCov3, rot);
      covariances.set(o.id, { state6: Float64Array.from(o.state6), posCov3 });
      covCount++;
    }
  }
  return {
    catalog,
    covariances,
    format,
    epoch: start,
    note: `${catalog.length} CDM objects, ${covCount} with covariance (miss ${summary.missDistanceM} m at TCA)`,
  };
}
