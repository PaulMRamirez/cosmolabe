// @bessel/terrain: terrain-masked line-of-sight. A DEM gives surface height above
// the reference sphere; an LOS is clear only if no point along it dips below the
// terrain surface. Pure (the DEM is a height function). This serves terrain-masked
// access; surface visualization is an MMGIS handoff. (STK_PARITY_SPEC §4.12.)

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A digital elevation model: height (m) above the reference sphere at a location. */
export interface Dem {
  heightAt(lonRad: number, latRad: number): number;
}

const mag = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** Body-fixed rectangular point (km) -> spherical lon/lat (rad) and radius (km). */
function toSpherical(p: Vec3): { lon: number; lat: number; r: number } {
  const r = mag(p);
  return { lon: Math.atan2(p.y, p.x), lat: r > 0 ? Math.asin(p.z / r) : 0, r };
}

/**
 * Is the straight line from `observer` to `target` (body-fixed km) clear of the
 * terrain? Samples the ray; the LOS is blocked if any interior point's radius drops
 * below the local surface (bodyRadiusKm + DEM height). Returns true when clear.
 */
export function terrainMaskedLos(
  observer: Vec3,
  target: Vec3,
  dem: Dem,
  bodyRadiusKm: number,
  samples = 256,
): boolean {
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const dz = target.z - observer.z;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p: Vec3 = { x: observer.x + dx * t, y: observer.y + dy * t, z: observer.z + dz * t };
    const { lon, lat, r } = toSpherical(p);
    const surface = bodyRadiusKm + dem.heightAt(lon, lat) / 1000;
    if (r < surface) return false; // the LOS passes below the terrain surface
  }
  return true;
}

/** A flat DEM (everywhere at the reference sphere): models curvature-only masking. */
export const FLAT_DEM: Dem = { heightAt: () => 0 };

/** Parameters of the synthetic ridge SAMPLE DEM: a deterministic, analytic heightfield standing
 *  in for a real DEM upload (which is out of scope here). This is illustrative SAMPLE data, NOT
 *  real terrain; the terrainLos constraint accepts any `Dem`, so a real source can replace it. */
export interface SampleRidgeParams {
  /** Constant base elevation (m) added everywhere above the reference sphere. */
  readonly baseM: number;
  /** Peak height (m) of the ridge crest, above the base. */
  readonly ridgeHeightM: number;
  /** Longitude (rad) the ridge crest runs along (the ridge is a band centered here). */
  readonly ridgeLonRad: number;
  /** Half-width (rad) of the ridge band: the raised-cosine taper falls to zero at this offset. */
  readonly ridgeHalfWidthRad: number;
}

/** Default sample-ridge parameters: a 2 km base plus a 6 km ridge crest at the prime meridian,
 *  tapering over ~0.15 rad, so an over-ridge line of sight is plausibly masked at orbital scale. */
export const DEFAULT_SAMPLE_RIDGE: SampleRidgeParams = {
  baseM: 2000,
  ridgeHeightM: 6000,
  ridgeLonRad: 0,
  ridgeHalfWidthRad: 0.15,
};

/** Normalize a longitude difference into (-pi, pi] so the ridge band wraps cleanly at +-pi. */
function wrapLon(d: number): number {
  let x = d;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * A built-in SAMPLE DEM: a deterministic, analytic ridge heightfield (NOT real terrain data). The
 * height is a constant base plus a longitudinal ridge whose crest follows `ridgeLonRad` and tapers
 * to the base over `ridgeHalfWidthRad` via a raised-cosine, modulated by cos(lat) so the ridge is
 * tallest at the equator and fades toward the poles. Pure and fully deterministic (no Math.random /
 * Date.now), so `heightAt` is unit-testable. Use only as illustrative sample data until a real
 * arbitrary-DEM source is plumbed in.
 */
export function sampleRidgeDem(params: SampleRidgeParams = DEFAULT_SAMPLE_RIDGE): Dem {
  const { baseM, ridgeHeightM, ridgeLonRad, ridgeHalfWidthRad } = params;
  return {
    heightAt(lonRad: number, latRad: number): number {
      const dLon = Math.abs(wrapLon(lonRad - ridgeLonRad));
      if (ridgeHalfWidthRad <= 0 || dLon >= ridgeHalfWidthRad) return baseM;
      // Raised-cosine band: 1 at the crest, 0 at the half-width edge.
      const band = 0.5 * (1 + Math.cos((Math.PI * dLon) / ridgeHalfWidthRad));
      // Latitude taper: cos(lat) fades the ridge toward the poles (clamped non-negative).
      const latFactor = Math.max(0, Math.cos(latRad));
      return baseM + ridgeHeightM * band * latFactor;
    },
  };
}

/** The default built-in sample ridge DEM instance, ready to thread into a terrainLos constraint. */
export const SAMPLE_RIDGE_DEM: Dem = sampleRidgeDem();
