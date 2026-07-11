// Direction vectors (to the Sun, to Earth, velocity) as colored arrows anchored at
// a body. Pure direction math is unit tested; the scene wraps it in ArrowHelpers.

import { ArrowHelper, Color, Group, Vector3 } from 'three';
import { SCALE, type Km3 } from './geometry-builders.ts';

export interface DirectionSpec {
  readonly label: string;
  /** Direction in km (any length); normalized internally. */
  readonly dirKm: Km3;
  readonly color: number;
}

export interface ArrowGeometry {
  /** Unit direction. */
  readonly direction: [number, number, number];
  /** Arrow tip in scene units = unit direction times length. */
  readonly tip: [number, number, number];
}

/** Normalize a direction and compute the scaled tip at the given scene length. */
export function buildArrow(dirKm: Km3, lengthUnits: number): ArrowGeometry {
  const m = Math.hypot(dirKm[0], dirKm[1], dirKm[2]) || 1;
  const direction: [number, number, number] = [dirKm[0] / m, dirKm[1] / m, dirKm[2] / m];
  return {
    direction,
    tip: [direction[0] * lengthUnits, direction[1] * lengthUnits, direction[2] * lengthUnits],
  };
}

/** Build a group of direction arrows of the given scene length. */
export function buildDirectionVectors(specs: readonly DirectionSpec[], lengthUnits: number): Group {
  const group = new Group();
  for (const spec of specs) {
    const { direction } = buildArrow(spec.dirKm, lengthUnits);
    const dir = new Vector3(direction[0], direction[1], direction[2]);
    const arrow = new ArrowHelper(dir, new Vector3(0, 0, 0), lengthUnits, new Color(spec.color).getHex());
    arrow.name = spec.label;
    group.add(arrow);
  }
  return group;
}

export const directionLengthUnits = (km: number): number => km * SCALE;
