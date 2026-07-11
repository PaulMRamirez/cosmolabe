// Default solar-system body table for the neutral scene: the Sun, the eight
// planets, Pluto, and Earth's Moon (every body the bundled de440s subset covers).
// Radii are physical (km); the scene keeps geometry true to scale and instead
// enforces a minimum apparent size per frame so distant bodies stay visible. A
// loaded catalog overrides this table with its own bodies.

export interface PlanetDef {
  readonly name: string;
  /** SPICE body id for ephemeris lookups (position relative to the Sun, 10). */
  readonly spiceId: string;
  /** Physical mean radius in km. */
  readonly radiusKm: number;
  /** Base RGB color (0..1) for the procedural texture (used when no image map). */
  readonly color: readonly [number, number, number];
  /** Optional image base-map URL; when set, replaces the procedural texture. */
  readonly texture?: string;
  /** Optional normal-map image URL for surface relief shading. */
  readonly normalMap?: string;
  /** Optional night-lights image URL; drives the emissive map (city lights). */
  readonly nightTexture?: string;
  /** Optional cloud-layer image URL; rendered as a separate translucent shell. */
  readonly cloudMap?: string;
  /** Cloud-shell altitude above the surface in km (defaults to 6.0 per Cosmographia). */
  readonly cloudAltitudeKm?: number;
  /** Optional specular color (0..1 RGB) for ocean glint; applied with specularPower. */
  readonly specularColor?: readonly [number, number, number];
  /** Optional specular sharpness; higher is glossier (lower roughness). */
  readonly specularPower?: number;
}

export const SOLAR_SYSTEM: readonly PlanetDef[] = [
  { name: 'Sun', spiceId: '10', radiusKm: 696000, color: [1.0, 0.83, 0.4] },
  { name: 'Mercury', spiceId: '1', radiusKm: 2440, color: [0.6, 0.57, 0.52] },
  { name: 'Venus', spiceId: '2', radiusKm: 6052, color: [0.85, 0.74, 0.5] },
  { name: 'Earth', spiceId: '399', radiusKm: 6371, color: [0.32, 0.5, 0.78] },
  { name: 'Moon', spiceId: '301', radiusKm: 1737, color: [0.55, 0.55, 0.58] },
  { name: 'Mars', spiceId: '4', radiusKm: 3390, color: [0.74, 0.38, 0.25] },
  { name: 'Jupiter', spiceId: '5', radiusKm: 69911, color: [0.78, 0.68, 0.54] },
  { name: 'Saturn', spiceId: '6', radiusKm: 58232, color: [0.86, 0.78, 0.6] },
  { name: 'Uranus', spiceId: '7', radiusKm: 25362, color: [0.62, 0.82, 0.85] },
  { name: 'Neptune', spiceId: '8', radiusKm: 24622, color: [0.28, 0.42, 0.82] },
  { name: 'Pluto', spiceId: '9', radiusKm: 1188, color: [0.76, 0.7, 0.62] },
];
