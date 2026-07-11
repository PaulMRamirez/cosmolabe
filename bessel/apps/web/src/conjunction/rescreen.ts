// [ux-p3-conjunction] Maneuver-then-rescreen: close the loop the Phase-2 plan-avoidance-burn
// carrier opened. Given a screened primary object's sampled ephemeris and the avoidance delta-v
// the analyst solved in the MCS (an along-track impulse at a burn epoch), build a MANEUVERED copy
// of the primary's ephemeris, re-screen it against the rest of the catalog (only the pairs that
// involve the primary), and compare the screened miss + Pc for the SAME secondary BEFORE vs AFTER
// the maneuver, so the analyst sees the risk reduction. All pure (no SPICE, no worker, no wall
// clock): the maneuver is modelled as a deterministic along-track drift applied to the supplied
// ephemeris samples, so the before/after comparison is a unit-tested function.

import {
  closestApproachLinear,
  collisionProbability2D,
  type SampledEphemeris,
  type ConjunctionEvent,
} from '@bessel/conjunction';

/** The avoidance maneuver to apply to a primary: an along-track (prograde) impulse of `dvKmS`
 *  (km/s) at epoch `burnEt` (ET seconds). The along-track direction is the primary's own velocity
 *  unit vector at the burn sample, so the model needs only the magnitude and the burn epoch. */
export interface AvoidanceManeuver {
  readonly dvKmS: number;
  readonly burnEt: number;
}

/** The before/after risk comparison for one tracked pair: the screened miss + Pc on the original
 *  catalog, the screened miss + Pc after the maneuver, and the derived deltas / reduced flag. The
 *  Pc is the 2D screen Pc the catalog screen produces (null when the pair carried no sigma/radius);
 *  the comparison reports the screened miss either way so the geometric improvement is always shown. */
export interface PcComparison {
  readonly primaryId: string;
  readonly secondaryId: string;
  readonly beforeMissKm: number;
  readonly afterMissKm: number | null;
  readonly beforePc: number | null;
  readonly afterPc: number | null;
  /** True when the after-maneuver Pc is strictly below the before Pc (risk fell). When a Pc is
   *  unavailable on either side, falls back to the screened miss increasing (a larger miss). */
  readonly reduced: boolean;
}

const NEAR_ZERO = 1e-12;

/** The along-track unit direction (the velocity unit vector) at sample `i` of an ephemeris, or
 *  null when the velocity is degenerate (zero) and no direction can be formed. Pure. */
function alongTrackUnit(eph: SampledEphemeris, i: number): readonly [number, number, number] | null {
  const vx = eph.vel[i * 3]!;
  const vy = eph.vel[i * 3 + 1]!;
  const vz = eph.vel[i * 3 + 2]!;
  const mag = Math.hypot(vx, vy, vz);
  if (!(mag > NEAR_ZERO)) return null;
  return [vx / mag, vy / mag, vz / mag];
}

/** The sample index in `eph.et` at (or just before) `burnEt`, clamped to the grid. Pure. */
function burnSampleIndex(eph: SampledEphemeris, burnEt: number): number {
  const n = eph.et.length;
  if (burnEt <= eph.et[0]!) return 0;
  if (burnEt >= eph.et[n - 1]!) return n - 1;
  let i = 0;
  while (i < n - 1 && eph.et[i + 1]! <= burnEt) i++;
  return i;
}

/**
 * Build a MANEUVERED copy of a primary ephemeris by applying an along-track impulse of `dvKmS`
 * at `burnEt`. The model is a deterministic, first-order along-track drift: from the burn sample
 * onward, each position is shifted by `dvHat * dvKmS * (t - burnEt)` and each velocity by
 * `dvHat * dvKmS`, where `dvHat` is the primary's velocity unit vector at the burn sample (a fixed
 * direction over the short screening window, so the drift is linear and SPICE-free). Samples before
 * the burn are unchanged. The id, grid epochs, sigma, and radius are preserved. Fails loud when the
 * burn-sample velocity is degenerate (no along-track direction) or `dvKmS` is not finite.
 */
export function buildManeuveredEphemeris(
  primary: SampledEphemeris,
  maneuver: AvoidanceManeuver,
): SampledEphemeris {
  if (!Number.isFinite(maneuver.dvKmS)) {
    throw new Error(`rescreen: avoidance delta-v must be finite (got ${maneuver.dvKmS})`);
  }
  const n = primary.et.length;
  const k = burnSampleIndex(primary, maneuver.burnEt);
  const dvHat = alongTrackUnit(primary, k);
  if (!dvHat) {
    throw new Error(`rescreen: primary "${primary.id}" has a degenerate velocity at the burn epoch`);
  }
  const pos = new Float64Array(primary.pos);
  const vel = new Float64Array(primary.vel);
  for (let i = k; i < n; i++) {
    const dt = primary.et[i]! - maneuver.burnEt;
    // Only drift forward in time from the burn (dt < 0 can occur on the burn sample itself when
    // burnEt sits between samples; clamp to 0 so the burn never shifts a pre-burn position).
    const drift = Math.max(0, dt) * maneuver.dvKmS;
    for (let c = 0; c < 3; c++) {
      pos[i * 3 + c] = primary.pos[i * 3 + c]! + dvHat[c]! * drift;
      vel[i * 3 + c] = primary.vel[i * 3 + c]! + dvHat[c]! * maneuver.dvKmS;
    }
  }
  return {
    id: primary.id,
    et: primary.et,
    pos,
    vel,
    ...(primary.radiusKm !== undefined ? { radiusKm: primary.radiusKm } : {}),
    ...(primary.sigmaKm !== undefined ? { sigmaKm: primary.sigmaKm } : {}),
  };
}

/** The closest approach of a single primary/secondary pair sampled on the SHARED grid: find the
 *  sample of minimum separation, then refine linearly about it (closestApproachLinear on the
 *  relative state at that sample). Pure, and deliberately LIGHT (a per-pair scan over the shared
 *  grid, reusing the rectilinear refinement) so the rescreen does not pull the full all-vs-all sieve
 *  into the lazy analysis bundle. The two ephemerides share a grid (the ingest sampler guarantees
 *  it), so a per-index relative state is well defined. Returns the flagged ConjunctionEvent (with a
 *  2D Pc when both objects carry radius + sigma), or null when the pair never closes below threshold. */
function pairClosestApproach(
  primary: SampledEphemeris,
  secondary: SampledEphemeris,
  thresholdKm: number,
): ConjunctionEvent | null {
  const n = Math.min(primary.et.length, secondary.et.length);
  let bestI = 0;
  let bestSep = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = primary.pos[i * 3]! - secondary.pos[i * 3]!;
    const dy = primary.pos[i * 3 + 1]! - secondary.pos[i * 3 + 1]!;
    const dz = primary.pos[i * 3 + 2]! - secondary.pos[i * 3 + 2]!;
    const sep = Math.hypot(dx, dy, dz);
    if (sep < bestSep) {
      bestSep = sep;
      bestI = i;
    }
  }
  // Refine within the bracketing interval about the minimum-separation sample using the relative
  // position + velocity there. closestApproachLinear extrapolates an infinite line, so clamp its TCA
  // to the local sample spacing (the refinement is only valid between adjacent samples); this keeps
  // the miss a COINCIDENT-TIME separation, not an infinite-line perpendicular distance.
  const i = bestI;
  const relPos = {
    x: primary.pos[i * 3]! - secondary.pos[i * 3]!,
    y: primary.pos[i * 3 + 1]! - secondary.pos[i * 3 + 1]!,
    z: primary.pos[i * 3 + 2]! - secondary.pos[i * 3 + 2]!,
  };
  const relVel = {
    x: primary.vel[i * 3]! - secondary.vel[i * 3]!,
    y: primary.vel[i * 3 + 1]! - secondary.vel[i * 3 + 1]!,
    z: primary.vel[i * 3 + 2]! - secondary.vel[i * 3 + 2]!,
  };
  const ca = closestApproachLinear(relPos, relVel);
  // The local interval half-width (seconds) the linear refinement is valid over.
  const n2 = primary.et.length;
  const dtLocal = i < n2 - 1 ? primary.et[i + 1]! - primary.et[i]! : primary.et[i]! - primary.et[i - 1]!;
  const tClamp = Math.max(-dtLocal, Math.min(dtLocal, ca.tca));
  const refined = Math.hypot(relPos.x + relVel.x * tClamp, relPos.y + relVel.y * tClamp, relPos.z + relVel.z * tClamp);
  const missKm = Math.min(bestSep, refined);
  if (missKm > thresholdKm) return null;
  let pc: number | null = null;
  if (
    primary.radiusKm !== undefined &&
    secondary.radiusKm !== undefined &&
    primary.sigmaKm !== undefined &&
    secondary.sigmaKm !== undefined
  ) {
    const sigma = Math.hypot(primary.sigmaKm, secondary.sigmaKm);
    pc = collisionProbability2D({
      radiusKm: primary.radiusKm + secondary.radiusKm,
      sigmaXKm: sigma,
      sigmaYKm: sigma,
      missXKm: missKm,
      missYKm: 0,
    });
  }
  return {
    primaryId: primary.id,
    secondaryId: secondary.id,
    tca: primary.et[i]! + tClamp,
    missKm,
    relSpeedKmS: ca.relSpeedKmS,
    pc,
  };
}

/**
 * Re-screen a MANEUVERED primary against the rest of the catalog, returning only the flagged events
 * that involve the primary (the pairs the analyst cares about after the burn). The maneuvered
 * primary replaces the original by id; the other catalog objects are unchanged. A generous threshold
 * is used so a now-larger miss is still captured as an event (otherwise a successful avoidance would
 * simply drop the pair below the flag distance and the after-miss would be unknown). Pure, and light:
 * a per-pair scan against only the primary's partners, not a full all-vs-all sieve. `padKm` is kept
 * in the signature for parity with the screening request but is folded into the threshold here.
 */
export function screenManeuveredPrimary(
  catalog: readonly SampledEphemeris[],
  maneuvered: SampledEphemeris,
  thresholdKm: number,
  padKm: number,
): readonly ConjunctionEvent[] {
  const flag = thresholdKm + Math.max(0, padKm);
  const events: ConjunctionEvent[] = [];
  for (const other of catalog) {
    if (other.id === maneuvered.id) continue;
    const ev = pairClosestApproach(maneuvered, other, flag);
    if (ev) events.push(ev);
  }
  return events;
}

/** Find the re-screened event for the same primary/secondary pair as `before`, order-independent. */
export function findPairEvent(
  events: readonly ConjunctionEvent[],
  primaryId: string,
  secondaryId: string,
): ConjunctionEvent | null {
  return (
    events.find(
      (e) =>
        (e.primaryId === primaryId && e.secondaryId === secondaryId) ||
        (e.primaryId === secondaryId && e.secondaryId === primaryId),
    ) ?? null
  );
}

/**
 * Compare the screened miss + Pc for one pair BEFORE vs AFTER the maneuver. Pure: takes the original
 * screened event and the re-screened (post-maneuver) event for the same pair (or null when the
 * maneuver opened the miss past the rescreen threshold, an unambiguous improvement). `reduced` is
 * true when the after Pc is strictly below the before Pc; when a Pc is unavailable on either side it
 * falls back to the miss increasing (or the pair dropping out of the rescreen entirely).
 */
export function comparePcBeforeAfter(
  before: ConjunctionEvent,
  after: ConjunctionEvent | null,
): PcComparison {
  const beforePc = before.pc;
  const afterPc = after ? after.pc : null;
  const afterMissKm = after ? after.missKm : null;
  let reduced: boolean;
  if (beforePc !== null && afterPc !== null) {
    reduced = afterPc < beforePc;
  } else if (afterMissKm === null) {
    // The pair dropped out of the rescreen: the maneuver opened the miss past the threshold.
    reduced = true;
  } else {
    reduced = afterMissKm > before.missKm;
  }
  return {
    primaryId: before.primaryId,
    secondaryId: before.secondaryId,
    beforeMissKm: before.missKm,
    afterMissKm,
    beforePc,
    afterPc,
    reduced,
  };
}
