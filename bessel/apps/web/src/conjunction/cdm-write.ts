// A small CCSDS-CDM-style (KVN, 508.0-B form) writer for the per-event "Export CDM" action
// (analysis-UX Phase 2: the SSA analyst's compare/export/decide close). @bessel/interop ships a
// parseCdm but no writer, so this co-located writer emits the inverse of parseCdm: the relative
// summary (TCA, miss distance, relative speed) plus the two object designators, the computed Pc,
// and, when available, the encounter-plane covariance entries. parseCdm(writeCdm(record)) round-
// trips the key relative fields (TCA, miss, relative speed, designators), which the unit test
// asserts. Pure, headless, deterministic (no Date.now/Math.random; the record carries every
// value). The covariance lines are written in the standard CDM keys (CR_R, CT_R, CT_T) from the
// encounter-plane 2x2 when present, so the export is a faithful CDM-style record of the event.

/** The per-object block of a CDM record: the designator and an optional name. */
export interface CdmWriteObject {
  /** OBJECT_DESIGNATOR (the catalog/object id). */
  readonly designator: string;
  /** OBJECT_NAME, when distinct from the designator. */
  readonly name?: string;
}

/** The encounter-plane 2x2 covariance entries (km^2) to emit, when a full-covariance Pc was
 *  computed; the 2x2 is written into the (R,T) covariance keys as the in-plane covariance. */
export interface CdmWriteCovariance {
  readonly cxx: number;
  readonly cxy: number;
  readonly cyy: number;
}

/** A CDM-style record to serialize: the relative summary, the two objects, the Pc, and an
 *  optional encounter-plane covariance. Every value is supplied (no wall-clock/RNG). */
export interface CdmRecord {
  /** TCA as an ISO UTC string (the event time, formatted by the caller). */
  readonly tca: string;
  /** Miss distance at TCA in metres (parseCdm reads/writes metres). */
  readonly missDistanceM: number;
  /** Relative speed at TCA in metres per second. */
  readonly relativeSpeedMS: number;
  /** Probability of collision (dimensionless, 0..1). */
  readonly collisionProbability: number;
  /** The primary object (OBJECT1) and secondary object (OBJECT2). */
  readonly object1: CdmWriteObject;
  readonly object2: CdmWriteObject;
  /** Optional message creation epoch (ISO UTC); the caller supplies it so the writer stays
   *  deterministic. Defaults to the TCA when omitted. */
  readonly creationDate?: string;
  /** Optional encounter-plane covariance to emit (km^2); omitted when no covariance was used. */
  readonly covariance?: CdmWriteCovariance;
}

/** Format a number for a KVN value: exponential with enough digits to round-trip a Float64. */
function num(n: number): string {
  return n.toExponential(12);
}

/** Emit one CDM OBJECT block (the designator + name + optional in-plane covariance keys). */
function objectBlock(label: 'OBJECT1' | 'OBJECT2', obj: CdmWriteObject, cov?: CdmWriteCovariance): string[] {
  const lines = [`OBJECT = ${label}`, `OBJECT_DESIGNATOR = ${obj.designator}`];
  if (obj.name !== undefined && obj.name !== obj.designator) lines.push(`OBJECT_NAME = ${obj.name}`);
  if (cov) {
    // The combined encounter-plane covariance is written once on OBJECT1 (the relative
    // covariance is a property of the pair, not of one object); 508.0 keys, km^2.
    lines.push(`CR_R = ${num(cov.cxx)} [km**2]`);
    lines.push(`CT_R = ${num(cov.cxy)} [km**2]`);
    lines.push(`CT_T = ${num(cov.cyy)} [km**2]`);
  }
  return lines;
}

/**
 * Serialize a CDM record to CCSDS-CDM-style KVN text. The header carries the version, creation
 * date, and message id; the relative metadata carries TCA, MISS_DISTANCE (m), RELATIVE_SPEED
 * (m/s), and COLLISION_PROBABILITY; then the two OBJECT blocks. parseCdm round-trips the TCA,
 * miss, relative speed, and designators. Pure and deterministic.
 */
export function writeCdm(record: CdmRecord): string {
  const created = record.creationDate ?? record.tca;
  const lines: string[] = [
    'CCSDS_CDM_VERS = 1.0',
    `CREATION_DATE = ${created}`,
    'ORIGINATOR = BESSEL',
    `MESSAGE_ID = ${record.object1.designator}-${record.object2.designator}-${record.tca}`,
    `TCA = ${record.tca}`,
    `MISS_DISTANCE = ${num(record.missDistanceM)} [m]`,
    `RELATIVE_SPEED = ${num(record.relativeSpeedMS)} [m/s]`,
    `COLLISION_PROBABILITY = ${num(record.collisionProbability)}`,
    ...objectBlock('OBJECT1', record.object1, record.covariance),
    ...objectBlock('OBJECT2', record.object2),
  ];
  return lines.join('\n') + '\n';
}
