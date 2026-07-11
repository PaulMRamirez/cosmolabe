// Pointing keep-out (exclusion) constraints: a sensor or antenna boresight must stay
// outside an angular cone about a bright body (Sun keep-out, Earth-limb avoidance,
// ...). Provides the pure angular geometry and a windowed analysis that finds the
// intervals over which the constraint holds, via sampling + bisection (the native
// geometry finder for this derived constraint). (STK_PARITY_SPEC §4.6.)

import type { AberrationCorrection, SpiceEngine, Vec3 } from '@bessel/spice';
import { findConstraintWindow, type EphemerisTime, type Window } from '@bessel/timeline';

/** Angular separation (rad) between two direction vectors, numerically robust. */
export function angularSeparationRad(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  const cross = Math.hypot(cx, cy, cz);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.atan2(cross, dot);
}

/** True when `boresight` falls within `halfAngleRad` of `bodyDir` (constraint violated). */
export function withinKeepOut(boresight: Vec3, bodyDir: Vec3, halfAngleRad: number): boolean {
  return angularSeparationRad(boresight, bodyDir) < halfAngleRad;
}

export interface KeepOutRequest {
  /** Observer (spacecraft) SPICE id/name, the apex of the boresight and body direction. */
  readonly observer: string;
  /** The bright body to exclude (e.g. "SUN"). */
  readonly exclusionBody: string;
  /** Keep-out cone half-angle (rad). */
  readonly halfAngleRad: number;
  /** The boresight direction in J2000 at an epoch (the caller derives it from attitude). */
  readonly boresightAt: (et: number) => Vec3;
  readonly span: readonly [EphemerisTime, EphemerisTime];
  readonly step: number;
  readonly abcorr?: AberrationCorrection;
}

/**
 * Intervals over [span] during which the boresight stays OUTSIDE the keep-out cone (the
 * constraint is satisfied): g(et) = separation(boresight, bodyDir) - halfAngle, access
 * where g >= 0. Crossings are refined by bisection.
 */
export async function keepOutWindow(spice: SpiceEngine, req: KeepOutRequest): Promise<Window> {
  const abcorr = req.abcorr ?? 'NONE';
  const g = async (et: number): Promise<number> => {
    const body = await spice.spkpos(req.exclusionBody, et, 'J2000', abcorr, req.observer);
    return angularSeparationRad(req.boresightAt(et), body.position) - req.halfAngleRad;
  };
  return findConstraintWindow(g, req.span, req.step);
}
