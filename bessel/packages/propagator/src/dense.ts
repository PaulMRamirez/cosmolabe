// Dense-output DOPRI5: the same adaptive stepper as integrator.ts, but instead of
// sampling onto a fixed grid it runs continuously to tf and snapshots every accepted
// step as a Hermite segment, yielding a Solution that interpolates the state at ANY
// epoch in [t0, tf]. The continuous extension is the cubic Hermite built from the
// endpoints (y_old, f_old, y_new, f_new); f_new is the FSAL last stage (k[STAGES-1]),
// valid only because LAST_STAGE_IS_ENDPOINT. Event detection (events.ts) scans this
// same interpolant, so a stop epoch is found to root-finder precision, not grid
// precision. (STK_PARITY_SPEC §4.2.)
//
// NOTE: the accept/reject controller below is duplicated from integrator.ts (which
// samples onto a grid and needs no segments). Keep the two step controllers in sync:
// any change to the error norm, the safety/limit factors, or the collapse guard must
// land in both.

import { A, B, C, E, LAST_STAGE_IS_ENDPOINT, STAGES } from './integrator-coeffs.ts';
import { IntegrationError, OutOfDomainError } from './errors.ts';
import { errorScale, initialStep, rmsNorm, type IntegratorOptions, type Rhs } from './integrator.ts';
import { scanSegmentEvents, type EventHit, type EventSpec } from './events.ts';

if (!LAST_STAGE_IS_ENDPOINT) {
  // A tableau swap that breaks the FSAL endpoint would silently corrupt the dense
  // interpolant (f_new would not be the endpoint derivative). Fail at module load.
  throw new IntegrationError('dense output requires a tableau whose last stage is the step endpoint (FSAL)');
}

/** One accepted step, the unit of the continuous extension. */
export interface Segment {
  /** Step start epoch. */
  readonly tOld: number;
  /** Step length (s); tNew = tOld + h. */
  readonly h: number;
  /** State at tOld. */
  readonly y0: Float64Array;
  /** State at tNew. */
  readonly y1: Float64Array;
  /** Derivative at tOld. */
  readonly f0: Float64Array;
  /** Derivative at tNew (FSAL last stage). */
  readonly f1: Float64Array;
}

/** A continuous solution over [t0, tf]: interpolate the state at any epoch in range. */
export interface Solution {
  readonly t0: number;
  readonly tf: number;
  readonly dim: number;
  /** State at `t` (allocates). Throws OutOfDomainError outside [t0, tf]. */
  interpolate(t: number): Float64Array;
  /** State at `t` into `out` (alloc-free). Throws OutOfDomainError outside [t0, tf]. */
  interpolateInto(t: number, out: Float64Array): void;
}

export interface DenseOptions extends IntegratorOptions {
  /** Switching functions to scan as the arc is built; the earliest terminal root stops it. */
  readonly events?: readonly EventSpec[];
  /** Cap on accepted segments before failing loudly (default 1_000_000). */
  readonly maxSegments?: number;
}

export interface DenseResult {
  readonly solution: Solution;
  /** Event hits in ascending time (terminal hit, if any, is last). */
  readonly events: readonly EventHit[];
  /** True iff a terminal event truncated the arc before tf. */
  readonly stopped: boolean;
  /** The epoch the arc actually reached (tf, or the terminal-event epoch). */
  readonly tEnd: number;
}

/** Cubic Hermite at theta in [0,1] for one component: y0,y1 endpoints, f0,f1 slopes (x h). */
function hermite(theta: number, y0: number, y1: number, f0: number, f1: number, h: number): number {
  const t2 = theta * theta;
  const t3 = t2 * theta;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + theta;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y0 + h10 * h * f0 + h01 * y1 + h11 * h * f1;
}

function makeSolution(segments: readonly Segment[], t0: number, tf: number, dim: number): Solution {
  const starts = segments.map((s) => s.tOld);
  // Binary search for the segment whose [tOld, tOld+h] brackets t.
  const findSeg = (t: number): Segment => {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo]!;
  };
  const writeInto = (t: number, out: Float64Array): void => {
    if (t < t0 - 1e-9 || t > tf + 1e-9) throw new OutOfDomainError(t, t0, tf);
    const seg = findSeg(t);
    const theta = seg.h === 0 ? 0 : (t - seg.tOld) / seg.h;
    for (let i = 0; i < dim; i++) {
      out[i] = hermite(theta, seg.y0[i]!, seg.y1[i]!, seg.f0[i]!, seg.f1[i]!, seg.h);
    }
  };
  return {
    t0,
    tf,
    dim,
    interpolate(t: number): Float64Array {
      const out = new Float64Array(dim);
      writeInto(t, out);
      return out;
    },
    interpolateInto: writeInto,
  };
}

/**
 * Integrate dy/dt = f(t, y) from `t0` (state `y0`) continuously to `tf` (tf > t0),
 * snapshotting each accepted step as a Hermite segment. Optionally scan `events`: the
 * earliest terminal-event root truncates the arc. Returns the continuous Solution, the
 * event hits, and whether a terminal event stopped it early.
 */
export function integrateDense(rhs: Rhs, y0: Float64Array, t0: number, tf: number, opts: DenseOptions = {}): DenseResult {
  const n = y0.length;
  const rtol = opts.rtol ?? 1e-11;
  const atol = opts.atol ?? 1e-9;
  const maxRejects = opts.maxRejects ?? 50;
  const hMin = opts.hMin ?? 1e-9;
  const maxSegments = opts.maxSegments ?? 1_000_000;
  const events = opts.events ?? [];

  if (tf <= t0) throw new IntegrationError(`integrateDense requires tf > t0 (got t0=${t0}, tf=${tf})`);

  const k: Float64Array[] = Array.from({ length: STAGES }, () => new Float64Array(n));
  const ytmp = new Float64Array(n);
  const y5 = new Float64Array(n);
  const sc = new Float64Array(n);
  const errVec = new Float64Array(n);

  let t = t0;
  const y = Float64Array.from(y0);

  rhs(t, y, k[0]!);
  for (let i = 0; i < n; i++) sc[i] = errorScale(atol, rtol, Math.abs(y[i]!));
  let h = initialStep(rhs, t, y, k[0]!, sc);

  const segments: Segment[] = [];
  const hits: EventHit[] = [];
  let stopped = false;
  let tEnd = tf;

  while (t < tf - 1e-9) {
    let rejects = 0;
    for (;;) {
      const hStep = Math.min(h, tf - t); // clamp so the final step lands on tf
      rhs(t, y, k[0]!);
      for (let s = 1; s < STAGES; s++) {
        for (let i = 0; i < n; i++) {
          let acc = 0;
          const row = A[s]!;
          for (let j = 0; j < s; j++) acc += row[j]! * k[j]![i]!;
          ytmp[i] = y[i]! + hStep * acc;
        }
        rhs(t + C[s]! * hStep, ytmp, k[s]!);
      }
      for (let i = 0; i < n; i++) {
        let bsum = 0;
        let esum = 0;
        for (let s = 0; s < STAGES; s++) {
          bsum += B[s]! * k[s]![i]!;
          esum += E[s]! * k[s]![i]!;
        }
        y5[i] = y[i]! + hStep * bsum;
        errVec[i] = hStep * esum;
      }
      for (let i = 0; i < n; i++) sc[i] = errorScale(atol, rtol, Math.max(Math.abs(y[i]!), Math.abs(y5[i]!)));
      const err = rmsNorm(errVec, sc);
      if (!Number.isFinite(err)) throw new IntegrationError('non-finite derivative during integration');

      if (err <= 1) {
        // Accept: snapshot the segment (FSAL k[STAGES-1] is the endpoint derivative).
        const seg: Segment = {
          tOld: t,
          h: hStep,
          y0: Float64Array.from(y),
          y1: Float64Array.from(y5),
          f0: Float64Array.from(k[0]!),
          f1: Float64Array.from(k[STAGES - 1]!),
        };
        segments.push(seg);
        if (segments.length > maxSegments) {
          throw new IntegrationError(`dense integration exceeded ${maxSegments} segments at t=${t}`);
        }
        t += hStep;
        y.set(y5);
        const fac = 0.9 * err ** (-1 / 5);
        h = h * Math.min(5, Math.max(0.2, fac));

        // Scan this segment for event roots on its own continuous extension.
        if (events.length > 0) {
          const segSol = makeSolution([seg], seg.tOld, seg.tOld + seg.h, n);
          const segHits = scanSegmentEvents(events, segSol, seg.tOld, seg.tOld + seg.h);
          if (segHits.length > 0) {
            const terminal = segHits.find((hit) => events[hit.specIndex]!.terminal);
            for (const hit of segHits) {
              hits.push(hit);
              if (events[hit.specIndex]!.terminal) break;
            }
            if (terminal) {
              stopped = true;
              tEnd = terminal.t;
              break;
            }
          }
        }
        break;
      }
      rejects += 1;
      const fac = Math.max(0.2, 0.9 * err ** (-1 / 5));
      h = h * Math.min(1, fac);
      if (rejects > maxRejects || hStep <= hMin) {
        throw new IntegrationError(`step size collapsed at t=${t} (err=${err}, h=${hStep})`);
      }
    }
    if (stopped) break;
  }

  // A legal but sub-step-floor window (e.g. tf = t0 + 1e-10) passes the tf > t0 guard yet the
  // step loop never accepts a segment; without this guard the makeSolution below would deref
  // segments[-1] and throw a raw TypeError. Fail loudly with a located, typed error instead.
  if (segments.length === 0) {
    throw new IntegrationError(`dense integration produced no segments: window [${t0}, ${tf}] is too small to take a step`);
  }

  // The accepted arc may stop short of tf at a terminal event (tEnd). Cap the Solution domain at
  // tEnd so interpolation cannot reach past the terminal event into physically stale states (e.g.
  // below the surface after an impact). When no event stopped the arc, tEnd is tf, so the domain
  // is the integrated span up to the last segment.
  const lastSeg = segments[segments.length - 1]!;
  const domainEnd = Math.min(tEnd, lastSeg.tOld + lastSeg.h);
  const solution = makeSolution(segments, t0, domainEnd, n);
  return { solution, events: hits, stopped, tEnd };
}
