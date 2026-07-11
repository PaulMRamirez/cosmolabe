// The MMGIS deep-link parameter contract for panel hosts, transcribed from
// the bessel heritage contract (heritage ADR-0008 and docs/integrations.md,
// themselves derived from the MMGIS repository's Deep_Linking document,
// which remains the source of truth). What survives contact with panel v0,
// and the recorded divergences:
//
// Transcribed: mission, mapLon, mapLat, mapZoom (the triple rule holds:
// the three map parameters are emitted together or not at all), centerPin,
// startTime, endTime. Divergence 1: the heritage builder (packages/state,
// buildMmgisUrl) is outbound only (Bessel to MMGIS); a panel host needs
// both directions, so this module adds parsing, and formatting emits a
// query string rather than a full URL (the host owns its own location).
// Divergence 2: two panel-specific parameters, bessel (the embed flag) and
// besselFocus (a product key to focus after mount), live outside MMGIS's
// documented namespace and are prefixed to say so. Divergence 3: the
// heritage selected and on parameters do not survive contact with panel v0
// (the panel has no MMGIS layer model to select into) and are not
// transcribed. Divergence 4: zoom derivation from footprint size stays in
// the heritage builder; a panel host owns its own map and supplies zoom
// directly.
//
// Time mapping: the panel's time axis is ET seconds (iron rule 9); deep
// links carry civil ISO strings (MMGIS startTime and endTime). The mapping
// here anchors the civil offset at the compute epoch the panel resolved:
// exact as long as no leap second falls inside the window, which is the
// honest limit of a host page that carries no SPICE, and is recorded here
// rather than hidden.

export interface MmgisPanelLink {
  readonly mission?: string;
  /** The map triple; all three present or all three absent (the triple rule). */
  readonly mapLon?: number;
  readonly mapLat?: number;
  readonly mapZoom?: number;
  readonly centerPin?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  /** Panel extension: mount the embedded panel (the flag of the W4 criterion). */
  readonly bessel?: boolean;
  /** Panel extension: product key to focus after mount. */
  readonly besselFocus?: string;
}

const num = (v: string | null): number | undefined => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseMmgisParams(search: string): MmgisPanelLink {
  const p = new URLSearchParams(search);
  const lon = num(p.get('mapLon'));
  const lat = num(p.get('mapLat'));
  const zoom = num(p.get('mapZoom'));
  const triple = lon !== undefined && lat !== undefined && zoom !== undefined;
  return {
    mission: p.get('mission') ?? undefined,
    ...(triple ? { mapLon: lon, mapLat: lat, mapZoom: zoom } : {}),
    centerPin: p.get('centerPin') ?? undefined,
    startTime: p.get('startTime') ?? undefined,
    endTime: p.get('endTime') ?? undefined,
    bessel: p.get('bessel') === '1' ? true : undefined,
    besselFocus: p.get('besselFocus') ?? undefined,
  };
}

export function formatMmgisParams(link: MmgisPanelLink): string {
  const p = new URLSearchParams();
  if (link.mission !== undefined) p.set('mission', link.mission);
  const triple =
    link.mapLon !== undefined && link.mapLat !== undefined && link.mapZoom !== undefined;
  if (triple) {
    p.set('mapLon', String(link.mapLon));
    p.set('mapLat', String(link.mapLat));
    p.set('mapZoom', String(link.mapZoom));
  }
  if (link.centerPin !== undefined) p.set('centerPin', link.centerPin);
  if (link.startTime !== undefined) p.set('startTime', link.startTime);
  if (link.endTime !== undefined) p.set('endTime', link.endTime);
  if (link.bessel) p.set('bessel', '1');
  if (link.besselFocus !== undefined) p.set('besselFocus', link.besselFocus);
  return p.toString();
}

/**
 * Map a deep link's civil startTime onto the panel's ET axis, anchored at
 * the compute epoch (epochIso resolved to epochEt by the substrate). Exact
 * modulo leap seconds inside the window; see the module doc.
 */
export function cursorEtFromStartTime(
  startTime: string,
  epochIso: string,
  epochEt: number,
): number | null {
  const start = Date.parse(startTime);
  const epoch = Date.parse(ensureUtc(epochIso));
  if (Number.isNaN(start) || Number.isNaN(epoch)) return null;
  return epochEt + (start - epoch) / 1000;
}

/** The reverse mapping, for writing the cursor back into a deep link. */
export function startTimeFromCursorEt(et: number, epochIso: string, epochEt: number): string {
  const epoch = Date.parse(ensureUtc(epochIso));
  return new Date(epoch + (et - epochEt) * 1000).toISOString();
}

/** The substrate epoch strings are naked UTC (str2et semantics); Date.parse
 *  would read them as local time, so the anchor is made explicit here. */
function ensureUtc(iso: string): string {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
}
