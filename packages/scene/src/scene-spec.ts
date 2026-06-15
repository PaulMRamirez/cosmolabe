// SceneSpec: a plain-data description of what a mission scene contains, with no
// SPICE and no Three.js construction. The app side (mission orchestrator)
// computes one of these from a catalog plus SPICE state; scene-builder turns it
// into Three.js objects via the SolarSystemScene setters. Keeping it pure data
// makes the build step headless-testable and preserves the dependency rule:
// @bessel/scene never reaches up into SPICE or the app.

import type { Km3 } from './geometry-builders.ts';
import type { PlanetDef } from './planets.ts';
import type { Star } from './star-catalog.ts';
import type { DirectionSpec } from './direction-vectors.ts';

/** A 3x3 rotation, row-major, as SPICE pxform returns it. */
export type Rotation3x3 = readonly number[];

export interface SpacecraftSpec {
  readonly name: string;
  readonly radiusKm?: number;
}

export interface TrajectorySpec {
  readonly points: readonly Km3[];
  readonly anchorBody: string;
}

export interface RingSpec {
  readonly body: string;
  readonly innerKm: number;
  readonly outerKm: number;
  readonly rotationRowMajor3x3?: Rotation3x3;
}

export interface AxisTriadSpec {
  readonly id: string;
  readonly body: string;
  readonly rotationRowMajor3x3?: Rotation3x3;
  readonly lengthKm: number;
}

export interface AtmosphereSpec {
  readonly body: string;
  readonly innerKm: number;
  readonly outerKm: number;
  readonly sunDirection: Km3;
  readonly visible: boolean;
}

export interface DirectionVectorsSpec {
  readonly anchorBody: string;
  readonly specs: readonly DirectionSpec[];
  readonly lengthKm: number;
}

export interface CameraSpec {
  readonly focus: string;
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
}

/** Everything needed to populate a SolarSystemScene, as inert data. */
export interface SceneSpec {
  readonly bodies: readonly PlanetDef[];
  readonly spacecraft?: SpacecraftSpec;
  readonly trajectory?: TrajectorySpec;
  readonly starField?: readonly Star[];
  readonly rings?: readonly RingSpec[];
  readonly axisTriads?: readonly AxisTriadSpec[];
  readonly atmospheres?: readonly AtmosphereSpec[];
  readonly directionVectors?: readonly DirectionVectorsSpec[];
  readonly camera?: CameraSpec;
}
