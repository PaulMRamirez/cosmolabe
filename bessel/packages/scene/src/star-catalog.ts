// Star catalog parsing and the right-ascension/declination to unit-vector
// conversion. Pure and unit tested; malformed rows fail loudly with a located
// error (the loud-failure principle).

export interface Star {
  /** Right ascension, degrees. */
  readonly ra: number;
  /** Declination, degrees. */
  readonly dec: number;
  /** Visual magnitude (smaller is brighter). */
  readonly mag: number;
}

export class StarCatalogError extends Error {
  constructor(
    message: string,
    readonly location: string,
  ) {
    super(message);
    this.name = 'StarCatalogError';
  }
}

const DEG2RAD = Math.PI / 180;

/** Convert RA/Dec in degrees to a J2000 unit vector. */
export function radec2vec(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

function num(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StarCatalogError(`Expected a finite number at ${location}`, location);
  }
  return value;
}

/** Parse a star catalog (array of {ra, dec, mag}) with located errors. */
export function parseStarCatalog(raw: unknown): Star[] {
  if (!Array.isArray(raw)) {
    throw new StarCatalogError('Star catalog must be an array', '$');
  }
  return raw.map((row, i) => {
    if (typeof row !== 'object' || row === null) {
      throw new StarCatalogError('Star row must be an object', `$[${i}]`);
    }
    const r = row as Record<string, unknown>;
    return {
      ra: num(r['ra'], `$[${i}].ra`),
      dec: num(r['dec'], `$[${i}].dec`),
      mag: num(r['mag'], `$[${i}].mag`),
    };
  });
}
