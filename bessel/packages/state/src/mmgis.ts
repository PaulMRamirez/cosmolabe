// Outbound MMGIS deep links (docs/integrations.md Section 2, ADR-0008). Bessel
// hands a selected surface point to MMGIS. The mapLon, mapLat, mapZoom triple is
// always sent together (the triple rule); centerPin keeps the handoff point
// visible; startTime and endTime are included when an epoch window is supplied.

export interface MmgisMissionConfig {
  /** MMGIS host base, for example https://mmgis.example. */
  readonly host: string;
  /** MMGIS mission name from the active Bessel plugin. */
  readonly mission: string;
}

export interface MmgisHandoff {
  /** Selected point longitude, degrees (MMGIS map convention). */
  readonly lon: number;
  /** Selected point latitude, degrees. */
  readonly lat: number;
  /** Explicit zoom; if omitted it is derived from the footprint angular size. */
  readonly zoom?: number;
  /** Footprint angular size in degrees, used to derive zoom when zoom is absent. */
  readonly footprintAngularSizeDeg?: number;
  /** Hover text naming the source (instrument and epoch). */
  readonly centerPin?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

function deriveZoom(handoff: MmgisHandoff): number {
  if (typeof handoff.zoom === 'number') return handoff.zoom;
  const size = handoff.footprintAngularSizeDeg ?? 1;
  // Smaller footprints zoom in further; clamp to a sane MMGIS range.
  const z = Math.round(8 - Math.log2(Math.max(1e-3, size)));
  return Math.max(1, Math.min(18, z));
}

/** Build a well-formed outbound MMGIS deep link URL. */
export function buildMmgisUrl(config: MmgisMissionConfig, handoff: MmgisHandoff): string {
  const params = new URLSearchParams();
  params.set('mission', config.mission);
  // The triple, always together.
  params.set('mapLon', String(handoff.lon));
  params.set('mapLat', String(handoff.lat));
  params.set('mapZoom', String(deriveZoom(handoff)));
  if (handoff.centerPin) params.set('centerPin', handoff.centerPin);
  if (handoff.startTime) params.set('startTime', handoff.startTime);
  if (handoff.endTime) params.set('endTime', handoff.endTime);
  const base = config.host.replace(/\/+$/, '');
  return `${base}/?${params.toString()}`;
}
