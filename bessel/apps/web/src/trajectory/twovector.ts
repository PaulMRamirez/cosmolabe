// TwoVector orientation resolver (item 5 / backlog C18): turn a catalog
// Orientation of type 'TwoVector' into a per-epoch attitude. A TwoVector
// orientation declares a primary and a secondary reference direction; each is
// either a fixed body-frame axis (an explicit 3-vector or a named axis like 'z'
// or '-x') or a direction toward a target body (resolved via spkpos from the
// observer to the target at the epoch). The primary body axis is aligned with
// the primary direction; the secondary body axis lies in the primary-secondary
// plane. CSPICE twovec builds the orthonormal frame and the transpose gives the
// body-to-inertial rotation, so this matches NAIF geometry exactly.
//
// The directions move (a target direction changes as the bodies move), so the
// engine re-evaluates this every frame from the resolved spec, exactly like the
// throttled SPICE/CK attitude path. Failures are loud, located errors.

import type { Mat3, SpiceEngine, Vec3 } from '@bessel/spice';
import type { Orientation, ReferenceDirection } from '@bessel/catalog';
import { TrajectoryError } from './shared.ts';

/** Body-frame axis index for twovec: 1 = X, 2 = Y, 3 = Z. */
type AxisIndex = 1 | 2 | 3;

/** A resolved TwoVector spec: the observer, the two directions, and their body axes. */
export interface TwoVectorSpec {
  /** SPICE observer id the target directions are computed from (the spacecraft). */
  readonly observerId: string;
  /** Frame the reference directions are expressed in (J2000). */
  readonly frame: string;
  readonly primary: ResolvedDirection;
  readonly secondary: ResolvedDirection;
}

/** A reference direction resolved to a fixed vector or a target to look up per epoch. */
type ResolvedDirection =
  | {
      readonly kind: 'fixed';
      readonly vector: readonly [number, number, number];
      readonly axisIndex: AxisIndex;
    }
  | { readonly kind: 'target'; readonly target: string; readonly axisIndex: AxisIndex };

const NAMED_AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
  '-x': [-1, 0, 0],
  '-y': [0, -1, 0],
  '-z': [0, 0, -1],
};

/** The body axis (twovec index) a named or explicit axis aligns: which component dominates. */
function axisIndexOf(axis: ReferenceDirection['axis']): AxisIndex {
  if (axis === undefined || typeof axis === 'string') {
    if (axis === 'y' || axis === '-y') return 2;
    if (axis === 'z' || axis === '-z') return 3;
    // 'x', '-x', or undefined: the natural default.
    return 1;
  }
  const ax = Math.abs(axis[0] ?? 0);
  const ay = Math.abs(axis[1] ?? 0);
  const az = Math.abs(axis[2] ?? 0);
  if (ax >= ay && ax >= az) return 1;
  if (ay >= az) return 2;
  return 3;
}

/** Located TwoVector error (a bad-catalog reference per the fail-loudly convention). */
export class TwoVectorError extends TrajectoryError {
  constructor(message: string, cause?: unknown) {
    super('Spice', `TwoVector orientation: ${message}`, cause);
    this.name = 'TwoVectorError';
  }
}

/**
 * Resolve one catalog ReferenceDirection into a fixed body-frame vector or a
 * target-lookup, with the body axis it constrains. `defaultAxisIndex` is used
 * when the direction declares no explicit axis (primary defaults to X, secondary
 * to Y). A direction must declare either an axis or a target; fail loud otherwise.
 */
function resolveDirection(
  dir: ReferenceDirection | undefined,
  role: 'primary' | 'secondary',
  defaultAxisIndex: AxisIndex,
): ResolvedDirection {
  if (!dir) {
    throw new TwoVectorError(`${role} reference direction is missing`);
  }
  if (dir.target !== undefined) {
    const axisIndex = dir.axis !== undefined ? axisIndexOf(dir.axis) : defaultAxisIndex;
    return { kind: 'target', target: dir.target, axisIndex };
  }
  if (dir.axis !== undefined) {
    const axis = dir.axis;
    const vector =
      typeof axis === 'string'
        ? NAMED_AXES[axis]
        : ([axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0] as const);
    if (!vector) {
      throw new TwoVectorError(`${role} reference direction has an unknown axis "${String(axis)}"`);
    }
    if (Math.hypot(vector[0], vector[1], vector[2]) < 1e-12) {
      throw new TwoVectorError(`${role} reference direction axis vector is degenerate (zero length)`);
    }
    return { kind: 'fixed', vector, axisIndex: axisIndexOf(axis) };
  }
  throw new TwoVectorError(`${role} reference direction declares neither an axis nor a target`);
}

/**
 * Build a resolved TwoVector spec from a catalog Orientation. `observerId` is the
 * spacecraft SPICE id the target directions are computed from. Throws a located
 * error if the orientation is not a TwoVector or its directions are malformed.
 */
export function planTwoVector(orientation: Orientation, observerId: string): TwoVectorSpec {
  if (orientation.type !== 'TwoVector') {
    throw new TwoVectorError(`orientation type "${orientation.type}" is not TwoVector`);
  }
  const primary = resolveDirection(orientation.primary, 'primary', 1);
  const secondary = resolveDirection(orientation.secondary, 'secondary', 2);
  if (primary.axisIndex === secondary.axisIndex) {
    throw new TwoVectorError(
      `primary and secondary must constrain different body axes (both resolved to axis ${primary.axisIndex})`,
    );
  }
  return { observerId, frame: orientation.frame ?? 'J2000', primary, secondary };
}

/** Evaluate one resolved direction at an epoch into a J2000 vector. */
async function directionAt(
  spice: SpiceEngine,
  dir: ResolvedDirection,
  observerId: string,
  frame: string,
  et: number,
): Promise<Vec3> {
  if (dir.kind === 'fixed') {
    return { x: dir.vector[0], y: dir.vector[1], z: dir.vector[2] };
  }
  let pos;
  try {
    pos = await spice.spkpos(dir.target, et, frame, 'NONE', observerId);
  } catch (err) {
    throw new TwoVectorError(
      `cannot resolve direction to target "${dir.target}" from observer "${observerId}" at et ${et}`,
      err,
    );
  }
  const { x, y, z } = pos.position;
  if (Math.hypot(x, y, z) < 1e-9) {
    throw new TwoVectorError(`direction to target "${dir.target}" is degenerate (observer at target)`);
  }
  return pos.position;
}

/**
 * Resolve a TwoVector orientation to a body-to-inertial (frame -> J2000) row-major
 * 3x3 rotation at `et`. The primary body axis points along the primary direction;
 * the secondary body axis lies in the primary-secondary plane. CSPICE twovec
 * returns the inertial-to-body matrix (rows are the body axes in J2000), so its
 * transpose is the body-to-inertial rotation the scene's setSpacecraftAttitude
 * (applyAttitude) consumes, matching the pxform(scFrame, J2000) convention.
 */
export async function resolveTwoVector(
  spice: SpiceEngine,
  spec: TwoVectorSpec,
  et: number,
): Promise<Mat3> {
  const [primaryVec, secondaryVec] = await Promise.all([
    directionAt(spice, spec.primary, spec.observerId, spec.frame, et),
    directionAt(spice, spec.secondary, spec.observerId, spec.frame, et),
  ]);
  let inertialToBody: Mat3;
  try {
    inertialToBody = await spice.twovec(
      primaryVec,
      spec.primary.axisIndex,
      secondaryVec,
      spec.secondary.axisIndex,
    );
  } catch (err) {
    throw new TwoVectorError('twovec failed (primary and secondary directions may be parallel)', err);
  }
  return transpose3x3(inertialToBody);
}

/** Transpose a row-major 3x3. Inertial-to-body (twovec) -> body-to-inertial. */
export function transpose3x3(m: Mat3): number[] {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
