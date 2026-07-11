// Pure projection + layout math for the ground-track overlay, factored out of the GroundTrackMap
// component so the lon/lat -> SVG-box mapping for each selectable projection is a single source of
// truth and unit-tested without rendering. Three projections are supported via @bessel/map-projection:
// equirectangular (Plate Carree), spherical Web Mercator, and polar stereographic. Longitudes and
// latitudes are radians. The map draws on a unit sphere (radius 1), so each projection's x/y span is
// fixed and the helper normalizes into the [0,w] x [0,h] SVG box (north up). (STK_PARITY_SPEC §4.12.)

import {
  equirectangularForward,
  webMercatorForward,
  polarStereographicForward,
  WEB_MERCATOR_MAX_LAT,
} from '@bessel/map-projection';

/** The selectable ground-track projection. */
export type GroundTrackProjection = 'equirectangular' | 'mercator' | 'polar-stereographic';

/** A point in the SVG box (pixels), north up. */
export interface BoxPoint {
  readonly x: number;
  readonly y: number;
}

// The far latitude bound polar stereographic maps (the opposite pole is at infinity); the disk is
// drawn from the projection pole (+pi/2) down to this near-equatorial bound, keeping x/y finite.
const POLAR_MIN_LAT = -Math.PI / 3;

// On the unit sphere each projection's half-extent in x and y, used to normalize into the box.
// Equirectangular: x in [-pi, pi], y in [-pi/2, pi/2]. Mercator: square, x/y in [-pi, pi]. Polar:
// a disk of radius tan(pi/4 - POLAR_MIN_LAT/2) about the pole, centered in a square box.
const POLAR_RADIUS = Math.tan(Math.PI / 4 - POLAR_MIN_LAT / 2);

/** Map one lon/lat (radians) to the SVG box for the given projection, north up. Pure. */
export function projectToBox(
  lon: number,
  lat: number,
  kind: GroundTrackProjection,
  w: number,
  h: number,
): BoxPoint {
  if (kind === 'polar-stereographic') {
    // Center the disk in the box; the projection x is east, y is toward the prime meridian. The
    // forward returns y negative toward the meridian, so the box y (down) uses (radius - p.y).
    const clampedLat = Math.max(POLAR_MIN_LAT, lat);
    const p = polarStereographicForward({ lon, lat: clampedLat }, 1, 1);
    return {
      x: ((p.x + POLAR_RADIUS) / (2 * POLAR_RADIUS)) * w,
      y: ((p.y + POLAR_RADIUS) / (2 * POLAR_RADIUS)) * h,
    };
  }
  if (kind === 'mercator') {
    const clampedLat = Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, lat));
    const p = webMercatorForward({ lon, lat: clampedLat }, 1);
    const yMax = Math.PI;
    return { x: ((p.x + Math.PI) / (2 * Math.PI)) * w, y: ((yMax - p.y) / (2 * yMax)) * h };
  }
  const p = equirectangularForward({ lon, lat }, 1);
  const yMax = Math.PI / 2;
  return { x: ((p.x + Math.PI) / (2 * Math.PI)) * w, y: ((yMax - p.y) / (2 * yMax)) * h };
}

/** A station marker placed in the SVG box. */
export interface PlacedStation {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** A station to overlay: an id/name and its lon/lat (radians). */
export interface GroundTrackStation {
  readonly id: string;
  readonly name: string;
  readonly lonRad: number;
  readonly latRad: number;
}

/**
 * Place each station marker in the SVG box for the projection. A station whose latitude falls
 * outside the projection's drawable band (the far hemisphere in polar stereographic) is dropped
 * rather than placed at a clamped, misleading position. Pure: depends only on the inputs.
 */
export function placeStations(
  stations: readonly GroundTrackStation[],
  kind: GroundTrackProjection,
  w: number,
  h: number,
): PlacedStation[] {
  const placed: PlacedStation[] = [];
  for (const s of stations) {
    if (kind === 'polar-stereographic' && s.latRad < POLAR_MIN_LAT) continue;
    const p = projectToBox(s.lonRad, s.latRad, kind, w, h);
    placed.push({ id: s.id, name: s.name, x: p.x, y: p.y });
  }
  return placed;
}
