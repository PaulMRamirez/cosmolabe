// @bessel/map-projection: pure forward/inverse map projections for the 2D map view
// (orbital overlays only; general GIS is an MMGIS handoff). Equirectangular, spherical
// Web Mercator (EPSG:3857-compatible), and polar stereographic. Longitudes/latitudes
// are radians. (STK_PARITY_SPEC §4.12.)

/** WGS-84 equatorial radius (m): the Web Mercator sphere radius. */
export const EARTH_RADIUS_M = 6378137;
/** Web Mercator latitude clamp (~85.05113 deg), where the projection becomes square. */
export const WEB_MERCATOR_MAX_LAT = 2 * Math.atan(Math.exp(Math.PI)) - Math.PI / 2;

export interface Point2 {
  readonly x: number;
  readonly y: number;
}
export interface LonLat {
  readonly lon: number;
  readonly lat: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Equirectangular (Plate Carree): x = R*lon, y = R*lat. */
export function equirectangularForward(lonLat: LonLat, radius = EARTH_RADIUS_M): Point2 {
  return { x: radius * lonLat.lon, y: radius * lonLat.lat };
}
export function equirectangularInverse(p: Point2, radius = EARTH_RADIUS_M): LonLat {
  return { lon: p.x / radius, lat: p.y / radius };
}

/** Spherical Web Mercator (EPSG:3857). Latitude is clamped to +/-WEB_MERCATOR_MAX_LAT. */
export function webMercatorForward(lonLat: LonLat, radius = EARTH_RADIUS_M): Point2 {
  const lat = clamp(lonLat.lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT);
  return { x: radius * lonLat.lon, y: radius * Math.log(Math.tan(Math.PI / 4 + lat / 2)) };
}
export function webMercatorInverse(p: Point2, radius = EARTH_RADIUS_M): LonLat {
  return { lon: p.x / radius, lat: 2 * Math.atan(Math.exp(p.y / radius)) - Math.PI / 2 };
}

/**
 * Polar stereographic about a pole (north = +1, south = -1), unit sphere scaled by
 * `radius`. Maps the hemisphere to a disk; the far pole is at infinity.
 */
export function polarStereographicForward(lonLat: LonLat, pole: 1 | -1 = 1, radius = EARTH_RADIUS_M): Point2 {
  const lat = pole === 1 ? lonLat.lat : -lonLat.lat;
  const lon = pole === 1 ? lonLat.lon : -lonLat.lon;
  const k = radius * Math.tan(Math.PI / 4 - lat / 2); // distance from the projection center
  return { x: k * Math.sin(lon), y: -k * Math.cos(lon) };
}
export function polarStereographicInverse(p: Point2, pole: 1 | -1 = 1, radius = EARTH_RADIUS_M): LonLat {
  const rho = Math.hypot(p.x, p.y);
  const lat = Math.PI / 2 - 2 * Math.atan(rho / radius);
  const lon = Math.atan2(p.x, -p.y);
  return pole === 1 ? { lon, lat } : { lon: -lon, lat: -lat };
}
