// Native Bessel catalog types: a typed mirror of bessel-catalog.schema.json. The
// schema is the source of truth (validation runs against it); these types give
// the parser and scene builder a checked shape to consume.

export interface CssColorObject {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}
export type CssColor = string | CssColorObject;

export interface TimeRange {
  readonly start: string;
  readonly stop: string;
}

/** Classical orbital elements for a Keplerian trajectory. */
export interface KeplerianElements {
  /** Semi-major axis, km. */
  readonly a: number;
  /** Eccentricity. */
  readonly e: number;
  /** Inclination, radians. */
  readonly i: number;
  /** Right ascension of the ascending node, radians. */
  readonly raan: number;
  /** Argument of periapsis, radians. */
  readonly argp: number;
  /** Mean anomaly at epoch, radians. */
  readonly m0: number;
  /** Element epoch (UTC). */
  readonly epoch: string;
}

/**
 * A trajectory source. Discriminated on `type`, mirroring the schema oneOf.
 * Every branch carries the optional `center` and `frame` shared fields.
 */
export type Trajectory =
  | {
      readonly type: 'Spice';
      readonly target?: string;
      readonly center?: string;
      readonly frame?: string;
    }
  | {
      readonly type: 'Keplerian';
      readonly elements: KeplerianElements;
      readonly center?: string;
      readonly frame?: string;
      /** Gravitational parameter of the center, km^3/s^2. */
      readonly mu?: number;
    }
  | {
      readonly type: 'Tle';
      readonly line1: string;
      readonly line2: string;
      readonly center?: string;
      readonly frame?: string;
    }
  | {
      readonly type: 'Fixed';
      /** Position [x, y, z] in km, in the center frame. */
      readonly position: readonly [number, number, number];
      readonly center?: string;
      readonly frame?: string;
    }
  | {
      readonly type: 'Sampled';
      /** Path or URL of the sampled state file. */
      readonly source: string;
      readonly format?: 'xyz' | 'oem';
      readonly center?: string;
      readonly frame?: string;
    };

export type TrajectoryType = Trajectory['type'];

export const TRAJECTORY_TYPES: readonly TrajectoryType[] = [
  'Spice',
  'Keplerian',
  'Tle',
  'Fixed',
  'Sampled',
];

/**
 * One reference direction of a TwoVector orientation: either a fixed body-frame
 * axis (explicit vector or named axis), or a direction toward a target.
 */
export interface ReferenceDirection {
  readonly axis?: readonly [number, number, number] | 'x' | 'y' | 'z' | '-x' | '-y' | '-z';
  readonly target?: string;
  readonly frame?: string;
}

export interface Orientation {
  readonly type: 'Spice' | 'Fixed' | 'UniformRotation' | 'TwoVector';
  readonly frame?: string;
  readonly quaternion?: readonly [number, number, number, number];
  /** UniformRotation spin axis (body frame). */
  readonly axis?: readonly [number, number, number];
  /** UniformRotation spin rate, radians per second. */
  readonly ratePerSec?: number;
  /** UniformRotation reference epoch (UTC); defaults to the mission start. */
  readonly epoch?: string;
  /** TwoVector primary reference direction. */
  readonly primary?: ReferenceDirection;
  /** TwoVector secondary reference direction. */
  readonly secondary?: ReferenceDirection;
}

export type OrientationType = Orientation['type'];

export const ORIENTATION_TYPES: readonly OrientationType[] = [
  'Spice',
  'Fixed',
  'UniformRotation',
  'TwoVector',
];

/** Per-item label override, mirroring schema $defs.label. */
export interface Label {
  readonly text?: string;
  readonly color?: CssColor;
  readonly show?: boolean;
}

/**
 * Body mass, mirroring schema $defs.mass. The string form matches Cosmographia
 * for round-trip; the object form is the Bessel-preferred shape.
 */
export type Mass = string | { readonly value: number; readonly unit: string };

/** Trajectory plot styling, mirroring schema $defs.trajectoryPlot. */
export interface TrajectoryPlot {
  readonly duration?: string | number;
  readonly lead?: string | number;
  readonly trail?: string | number;
  readonly sampleCount?: number;
  readonly color?: CssColor;
  readonly fade?: number;
}

export interface Arc {
  readonly timeRange?: TimeRange;
  readonly trajectory: Trajectory;
  readonly orientation?: Orientation;
}

export type Geometry =
  | { readonly type: 'Mesh'; readonly source?: string; readonly scale?: number }
  | { readonly type: 'DSK'; readonly source?: string; readonly scale?: number }
  | {
      readonly type: 'Globe';
      readonly radii?: readonly [number, number, number];
      /** Diffuse base map (Cosmographia baseMap; "texture" is the native field). */
      readonly texture?: string;
      readonly nightTexture?: string;
      readonly normalMap?: string;
      /** Cloud-layer image; rendered as a separate translucent shell. */
      readonly cloudMap?: string;
      /** Cloud-shell altitude above the surface (km); defaults to 6.0. */
      readonly cloudAltitudeKm?: number;
      /** Specular tint for ocean glint; only applied with specularPower. */
      readonly specularColor?: CssColor;
      /** Specular sharpness (higher is glossier). */
      readonly specularPower?: number;
      /** Self-lit body (the Sun); skips lighting. */
      readonly emissive?: boolean;
      readonly atmosphere?: GlobeAtmosphere;
      readonly rings?: GeometryRings;
    }
  | GeometryRings
  | { readonly type: 'ParticleSystem'; readonly source?: string; readonly particleCount?: number }
  | { readonly type: 'KeplerianSwarm'; readonly source?: string; readonly color?: CssColor }
  | { readonly type: 'TimeSwitched'; readonly segments: readonly TimeSwitchedSegment[] };

export interface GeometryRings {
  readonly type: 'Rings';
  readonly innerRadius?: number;
  readonly outerRadius?: number;
  readonly texture?: string;
}

export interface GlobeAtmosphere {
  /** Inner shell radius (km); defaults to the body mean radius. */
  readonly innerRadius?: number;
  /** Outer shell radius (km); defaults to a small fraction above the surface. */
  readonly outerRadius?: number;
}

export interface TimeSwitchedSegment {
  readonly timeRange: TimeRange;
  readonly geometry: Geometry;
}

export type GeometryType = Geometry['type'];

export const GEOMETRY_TYPES: readonly GeometryType[] = [
  'Mesh',
  'DSK',
  'Globe',
  'Rings',
  'ParticleSystem',
  'KeplerianSwarm',
  'TimeSwitched',
];

export interface CatalogBody {
  readonly id: string;
  readonly name?: string;
  readonly label?: Label;
  readonly trajectory?: Trajectory;
  readonly orientation?: Orientation;
  readonly geometry?: Geometry;
  readonly trajectoryPlot?: TrajectoryPlot;
  readonly mass?: Mass;
}

export interface CatalogSpacecraft {
  readonly id: string;
  readonly name?: string;
  readonly label?: Label;
  readonly trajectory?: Trajectory;
  readonly arcs?: readonly Arc[];
  readonly orientation?: Orientation;
  readonly geometry?: Geometry;
  readonly trajectoryPlot?: TrajectoryPlot;
  readonly mass?: Mass;
}

export interface FovStyle {
  readonly color?: CssColor;
  readonly opacity?: number;
  readonly sideDivisions?: number;
  readonly footprint?: boolean;
  readonly colorByDistance?: unknown;
}

export interface CatalogInstrument {
  readonly id: string;
  readonly parent: string;
  readonly sensor: string;
  readonly targets: readonly string[];
  readonly fov?: {
    readonly shape?: string;
    readonly styles?: Readonly<Record<string, FovStyle>>;
  };
}

export interface CatalogObservation {
  readonly instrument: string;
  readonly target: string;
  readonly footprintColor?: CssColor;
  readonly intervals?: readonly TimeRange[];
}

export interface BesselCatalog {
  readonly name?: string;
  readonly version: string;
  readonly kernels?: {
    readonly baseUrl?: string;
    readonly paths?: readonly string[];
    readonly metaKernels?: readonly string[];
  };
  readonly bodies?: readonly CatalogBody[];
  readonly spacecraft?: readonly CatalogSpacecraft[];
  readonly instruments?: readonly CatalogInstrument[];
  readonly observations?: readonly CatalogObservation[];
}
