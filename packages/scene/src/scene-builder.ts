// Applies a SceneSpec to a scene through the imperative SolarSystemScene setters.
// It depends on a structural SceneTarget (the subset of methods it calls), so it
// is pure with respect to Three.js and can be unit-tested headlessly with a
// recording mock. SolarSystemScene satisfies SceneTarget structurally.

import type { Km3 } from './geometry-builders.ts';
import type { PlanetDef } from './planets.ts';
import type { Star } from './star-catalog.ts';
import type { DirectionSpec } from './direction-vectors.ts';
import type { SceneSpec } from './scene-spec.ts';

export interface SceneTarget {
  setBodies(defs: readonly PlanetDef[]): void;
  setSpacecraft(name: string, radiusKm?: number): void;
  setTrajectory(points: readonly Km3[], anchorBody?: string): void;
  setStarField(stars: readonly Star[]): void;
  setRings(
    anchorBody: string,
    innerRadiusKm: number,
    outerRadiusKm: number,
    rotationRowMajor3x3?: readonly number[],
  ): void;
  setAxisTriad(
    name: string,
    anchorBody: string,
    rotationRowMajor3x3: readonly number[],
    lengthKm: number,
  ): void;
  setAtmosphere(
    anchorBody: string,
    planetRadiusKm: number,
    atmosphereRadiusKm: number,
    params: { sunDirection: Km3 },
  ): void;
  setAtmosphereVisible(visible: boolean): void;
  setDirectionVectors(anchorBody: string, specs: readonly DirectionSpec[], lengthKm: number): void;
  centerOn(name: string): void;
  setView(azimuth: number, elevation: number, distance: number): void;
}

export function buildScene(target: SceneTarget, spec: SceneSpec): void {
  target.setBodies(spec.bodies);

  if (spec.spacecraft) {
    target.setSpacecraft(spec.spacecraft.name, spec.spacecraft.radiusKm);
  }

  if (spec.trajectory) {
    target.setTrajectory(spec.trajectory.points, spec.trajectory.anchorBody);
  }

  if (spec.starField) {
    // The star field is decorative; a parse or buffer failure should not abort
    // the rest of the scene build (loud, but non-fatal).
    try {
      target.setStarField(spec.starField);
    } catch (err) {
      console.error('star field failed', err);
    }
  }

  for (const ring of spec.rings ?? []) {
    target.setRings(ring.body, ring.innerKm, ring.outerKm, ring.rotationRowMajor3x3);
  }

  for (const triad of spec.axisTriads ?? []) {
    target.setAxisTriad(triad.id, triad.body, triad.rotationRowMajor3x3 ?? IDENTITY_3X3, triad.lengthKm);
  }

  for (const atmosphere of spec.atmospheres ?? []) {
    target.setAtmosphere(atmosphere.body, atmosphere.innerKm, atmosphere.outerKm, {
      sunDirection: atmosphere.sunDirection,
    });
    target.setAtmosphereVisible(atmosphere.visible);
  }

  for (const dir of spec.directionVectors ?? []) {
    target.setDirectionVectors(dir.anchorBody, dir.specs, dir.lengthKm);
  }

  if (spec.camera) {
    target.centerOn(spec.camera.focus);
    target.setView(spec.camera.azimuth, spec.camera.elevation, spec.camera.distance);
  }
}

const IDENTITY_3X3: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
