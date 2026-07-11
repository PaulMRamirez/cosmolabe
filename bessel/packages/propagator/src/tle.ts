// NORAD Two-Line Element (TLE) parser. Pure and headless: decodes the fixed-column
// fields, validates the mod-10 checksum, and converts the epoch to a UTC ISO 8601
// string (the caller turns that into ET via spice.str2et). Fails loudly with a
// located error. (STK_PARITY_SPEC §4.1, PROP-5.)

const DEG = Math.PI / 180;

export interface Tle {
  readonly satnum: number;
  /** Epoch as a UTC ISO 8601 string (convert to ET via spice.str2et). */
  readonly epochUtc: string;
  readonly inclination: number; // radians
  readonly raan: number; // radians
  readonly eccentricity: number;
  readonly argp: number; // radians
  readonly meanAnomaly: number; // radians
  readonly meanMotion: number; // revolutions per day
  /** First derivative of mean motion divided by two (rev/day^2). */
  readonly ndot: number;
  /** Second derivative of mean motion divided by six (rev/day^3). */
  readonly nddot: number;
  /** B* drag term (1/earth-radii). */
  readonly bstar: number;
}

/** TLE-format error with the offending line and reason. */
export class TleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TleError';
  }
}

/** Mod-10 checksum: digits sum, minus signs count 1, others 0; last column matches. */
function checksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i]!;
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48;
    else if (c === '-') sum += 1;
  }
  return sum % 10;
}

function assertChecksum(line: string, which: number): void {
  if (line.length < 69) throw new TleError(`line ${which} is too short (need 69 columns)`);
  const want = line.charCodeAt(68) - 48;
  const got = checksum(line);
  if (want !== got) throw new TleError(`line ${which} checksum ${line[68]} does not match computed ${got}`);
}

/** Decode an implied-decimal exponential field like " 28098-4" -> 0.28098e-4. */
function decodeExp(field: string): number {
  const s = field.trim();
  if (s === '' || s === '0' || s === '+0' || s === '-0' || /^[-+]?0+$/.test(s)) return 0;
  const sign = s[0] === '-' ? -1 : 1;
  const body = s.replace(/^[-+]/, '');
  const m = body.match(/^(\d+)([-+]\d)$/);
  if (!m) throw new TleError(`malformed exponential field "${field}"`);
  const mantissa = sign * Number(`0.${m[1]}`);
  return mantissa * 10 ** Number(m[2]);
}

/** Epoch (2-digit year + fractional day-of-year) to a UTC ISO 8601 string. */
function epochToUtc(yy: number, dayOfYear: number): string {
  const year = yy < 57 ? 2000 + yy : 1900 + yy; // standard TLE pivot
  const ms = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
  return new Date(ms).toISOString();
}

function num(field: string, line: number): number {
  const v = Number(field.trim());
  if (!Number.isFinite(v)) throw new TleError(`line ${line}: cannot parse number from "${field}"`);
  return v;
}

/**
 * Parse a NORAD TLE (two lines plus an optional name). Validates both checksums
 * and that the two lines agree on the satellite number.
 */
export function parseTle(line1: string, line2: string): Tle {
  if (line1[0] !== '1') throw new TleError('line 1 must begin with "1"');
  if (line2[0] !== '2') throw new TleError('line 2 must begin with "2"');
  assertChecksum(line1, 1);
  assertChecksum(line2, 2);

  const satnum1 = num(line1.slice(2, 7), 1);
  const satnum2 = num(line2.slice(2, 7), 2);
  if (satnum1 !== satnum2) throw new TleError(`satellite numbers differ (${satnum1} vs ${satnum2})`);

  const yy = num(line1.slice(18, 20), 1);
  const day = num(line1.slice(20, 32), 1);

  return {
    satnum: satnum1,
    epochUtc: epochToUtc(yy, day),
    ndot: num(line1.slice(33, 43), 1),
    nddot: decodeExp(line1.slice(44, 52)),
    bstar: decodeExp(line1.slice(53, 61)),
    inclination: num(line2.slice(8, 16), 2) * DEG,
    raan: num(line2.slice(17, 25), 2) * DEG,
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argp: num(line2.slice(34, 42), 2) * DEG,
    meanAnomaly: num(line2.slice(43, 51), 2) * DEG,
    meanMotion: num(line2.slice(52, 63), 2),
  };
}
