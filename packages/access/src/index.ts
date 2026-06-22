// @bessel/access: visibility/access analysis over a time span. Computes the
// interval Window during which an observer can "see" a target, subject to a
// composable constraint set, by reducing each constraint to a SpiceWindow (via the
// CSPICE geometry finders) and intersecting them. Core layer: depends only on
// @bessel/spice and @bessel/timeline (STK_PARITY_SPEC §4.3, Phase A).

import type { AberrationCorrection, SpiceEngine } from '@bessel/spice';
import {
  windowComplement,
  windowIntersectAll,
  type EphemerisTime,
  type Window,
} from '@bessel/timeline';
import { computeRangeRateWindow, type RangeRateConstraint } from './range-rate.ts';

/**
 * A line-of-sight constraint: the target must NOT be occulted by `body`. The
 * access window for it is the complement of the occultation intervals (gfoclt).
 */
export interface LineOfSightConstraint {
  readonly kind: 'lineOfSight';
  /** Occulting body (e.g. "SATURN"). */
  readonly body: string;
  /** Body-fixed frame of the occulting body (e.g. "IAU_SATURN"). */
  readonly bodyFrame: string;
}

/** A range constraint: observer-to-target distance within [minKm, maxKm] (gfdist). */
export interface RangeConstraint {
  readonly kind: 'range';
  readonly minKm?: number;
  readonly maxKm?: number;
}

export type AccessConstraint = LineOfSightConstraint | RangeConstraint | RangeRateConstraint;

export interface AccessRequest {
  /** Observing body/spacecraft (SPICE id or name). */
  readonly observer: string;
  /** Observed target (SPICE id or name). */
  readonly target: string;
  /** Search span [start, stop] in ET seconds. */
  readonly span: readonly [EphemerisTime, EphemerisTime];
  /** Geometry-finder search step (s); must be shorter than the briefest event. */
  readonly step: number;
  /** Constraints, intersected to form the access window. Empty = the whole span. */
  readonly constraints: readonly AccessConstraint[];
  readonly abcorr?: AberrationCorrection;
}

/**
 * Compute the access Window: the span intersected with each constraint's window.
 * With no constraints the result is the whole span.
 */
export async function computeAccess(spice: SpiceEngine, req: AccessRequest): Promise<Window> {
  const [t0, t1] = req.span;
  if (t1 <= t0) throw new Error(`access span must be increasing, got [${t0}, ${t1}]`);
  const abcorr = req.abcorr ?? 'NONE';
  const windows: Window[] = [[[t0, t1]]];
  for (const constraint of req.constraints) {
    windows.push(await constraintWindow(spice, req, abcorr, constraint));
  }
  return windowIntersectAll(windows);
}

export { computeElevationAccess, type Facility, type ElevationUp } from './facility.ts';
export {
  computeRangeRateWindow,
  rangeRateFromState,
  RangeRateConstraintError,
  type RangeRateConstraint,
} from './range-rate.ts';

/** One hop of an access chain: an observer seeing a target under constraints. */
export interface AccessLink {
  readonly observer: string;
  readonly target: string;
  readonly constraints: readonly AccessConstraint[];
}

/**
 * Compute chain (multi-hop relay) access: the intersection of every hop's access
 * window, so the chain is "up" only when all hops are simultaneously up.
 */
export async function computeChainAccess(
  spice: SpiceEngine,
  links: readonly AccessLink[],
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
  abcorr?: AberrationCorrection,
): Promise<Window> {
  if (links.length === 0) throw new Error('a chain needs at least one link');
  const perHop = await Promise.all(
    links.map((l) => computeAccess(spice, { observer: l.observer, target: l.target, span, step, constraints: l.constraints, abcorr })),
  );
  return windowIntersectAll(perHop);
}

async function constraintWindow(
  spice: SpiceEngine,
  req: AccessRequest,
  abcorr: AberrationCorrection,
  constraint: AccessConstraint,
): Promise<Window> {
  const [t0, t1] = req.span;
  if (constraint.kind === 'lineOfSight') {
    // Intervals where the target (a point) is occulted by the body; access is the
    // complement over the span.
    const occulted = await spice.gfoclt(
      'ANY',
      constraint.body,
      'ELLIPSOID',
      constraint.bodyFrame,
      req.target,
      'POINT',
      'J2000',
      abcorr,
      req.observer,
      req.step,
      t0,
      t1,
    );
    return windowComplement(t0, t1, occulted);
  }
  if (constraint.kind === 'rangeRate') {
    // Range rate (km/s) within the band, derived analytically from spkezr and refined
    // by the shared root-finder. See range-rate.ts.
    return computeRangeRateWindow(spice, req.observer, req.target, req.span, req.step, abcorr, constraint);
  }
  // range: intersect the (distance < max) and (distance > min) windows.
  const pieces: Window[] = [];
  if (constraint.maxKm !== undefined) {
    pieces.push(
      await spice.gfdist(req.target, abcorr, req.observer, '<', constraint.maxKm, req.step, t0, t1),
    );
  }
  if (constraint.minKm !== undefined) {
    pieces.push(
      await spice.gfdist(req.target, abcorr, req.observer, '>', constraint.minKm, req.step, t0, t1),
    );
  }
  return pieces.length === 0 ? [[t0, t1]] : windowIntersectAll(pieces);
}
