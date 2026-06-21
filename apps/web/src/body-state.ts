// Pure state-vector + osculating-element computation for the focused body, mirroring
// readouts.ts: a worker round-trip to spkezr (Cartesian state in a chosen frame),
// then the validated classical-element math from @bessel/propagator (rv2coe, Vallado).
// Returns null when the body is its own center or the orbit is degenerate (parabolic/
// rectilinear, which rv2coe rejects loudly), so the panel falls back to n/a rather than
// showing a wrong value.

import type { BodyState } from '@bessel/ui';
import type { SpiceEngine } from '@bessel/spice';
import { rv2coe } from '@bessel/propagator';
import { RAD2DEG } from './angles.ts';

export async function computeBodyState(
  spice: SpiceEngine,
  target: string,
  center: string,
  frame: string,
  et: number,
  mu: number,
): Promise<BodyState | null> {
  // A body relative to itself has no state or orbit; the Sun about the Sun likewise.
  if (target === center) return null;
  let sv;
  try {
    sv = await spice.spkezr(target, et, frame, 'NONE', center);
  } catch {
    return null;
  }
  // Classical elements straight from the state vector. rv2coe is the same tested path
  // the mission tooling uses, and it throws on a degenerate (parabolic/rectilinear)
  // orbit, which we surface as n/a instead of a fabricated semi-major axis or anomaly.
  let el;
  try {
    el = rv2coe(mu, sv.position, sv.velocity);
  } catch {
    return null;
  }
  return {
    target,
    center,
    r: [sv.position.x, sv.position.y, sv.position.z],
    v: [sv.velocity.x, sv.velocity.y, sv.velocity.z],
    semiMajorKm: el.sma,
    ecc: el.ecc,
    incDeg: el.inc * RAD2DEG,
    raanDeg: el.raan * RAD2DEG,
    argpDeg: el.argp * RAD2DEG,
    trueAnomalyDeg: el.trueAnomaly * RAD2DEG,
  };
}
