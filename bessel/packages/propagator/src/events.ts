// Event detection on a dense Solution: locate epochs where a switching function
// g(t, y) crosses zero (periapsis, node crossing, altitude threshold, terminal stop).
// Each accepted segment's continuous extension is scanned for sign changes (filtered by
// crossing direction), and each bracket is refined to the root with Brent's method on
// the interpolant. A terminal event stops the arc at its earliest root. The integrator
// owns stepping; this module owns only root location, so it stays testable against
// closed-form g (e.g. g = r.v has its zero at periapsis). (STK_PARITY_SPEC §4.2.)

import { EventError } from './errors.ts';
import type { Solution } from './dense.ts';

/** A switching function and how to treat its zeros. */
export interface EventSpec {
  /** Provenance label, copied onto every hit. */
  readonly name: string;
  /** Switching function; its sign changes mark events. */
  g(t: number, y: Float64Array): number;
  /** Which crossings count: +1 rising (-> +), -1 falling (+ -> -), 0 either (default 0). */
  readonly direction?: -1 | 0 | 1;
  /** If true, the earliest root truncates the arc. */
  readonly terminal?: boolean;
  /** Root tolerance in t (s); default 1e-6. */
  readonly tol?: number;
}

/** A located zero crossing of one EventSpec. */
export interface EventHit {
  /** The spec's name. */
  readonly name: string;
  /** Index of the spec in the scanned array (lets the caller read terminal/etc.). */
  readonly specIndex: number;
  /** Root epoch. */
  readonly t: number;
  /** Interpolated state at the root. */
  readonly y: Float64Array;
  /** Crossing direction at the root: +1 rising, -1 falling. */
  readonly direction: -1 | 1;
}

/** Number of sub-intervals each segment is sampled into when hunting sign changes. */
const SUBSAMPLES = 8;

/**
 * Find every qualifying root of each `events` spec inside [ta, tb] on `solution`,
 * returned in ascending epoch order. Each segment is sub-sampled to bracket sign
 * changes; each bracket is refined with Brent's method on the interpolated g.
 */
export function scanSegmentEvents(
  events: readonly EventSpec[],
  solution: Solution,
  ta: number,
  tb: number,
): EventHit[] {
  const hits: EventHit[] = [];
  const scratch = new Float64Array(solution.dim);
  const gAt = (spec: EventSpec, t: number): number => {
    solution.interpolateInto(t, scratch);
    return spec.g(t, scratch);
  };

  for (let si = 0; si < events.length; si++) {
    const spec = events[si]!;
    const want = spec.direction ?? 0;
    const tol = spec.tol ?? 1e-6;
    let gLeft = gAt(spec, ta);
    let tLeft = ta;
    for (let k = 1; k <= SUBSAMPLES; k++) {
      const tRight = ta + ((tb - ta) * k) / SUBSAMPLES;
      const gRight = gAt(spec, tRight);
      // Half-open convention: the RIGHT endpoint owns an exact zero, so an exact root on
      // a sample boundary (or at the global start t0, the left endpoint of segment 1) is
      // counted once and never twice across adjacent intervals/segments.
      let root: number | null = null;
      let dir: -1 | 1 = 1;
      if (gRight === 0) {
        if (gLeft !== 0) {
          root = tRight;
          dir = gLeft < 0 ? 1 : -1;
        }
      } else if (gLeft !== 0 && (gLeft < 0) !== (gRight < 0)) {
        dir = gRight > gLeft ? 1 : -1;
        root = brent((t) => gAt(spec, t), tLeft, tRight, gLeft, gRight, tol);
      }
      if (root !== null && (want === 0 || want === dir)) {
        hits.push({ name: spec.name, specIndex: si, t: root, y: solution.interpolate(root), direction: dir });
      }
      gLeft = gRight;
      tLeft = tRight;
    }
  }

  hits.sort((p, q) => p.t - q.t);
  return hits;
}

/**
 * Brent's method (inverse-quadratic / secant with bisection fallback) for the root of
 * `f` in [a, b], given the bracketing values fa, fb (fa*fb <= 0). Throws EventError if
 * the bracket is invalid or it fails to converge. Not exported: an internal of the
 * scanner, validated through it.
 */
function brent(
  f: (t: number) => number,
  a: number,
  b: number,
  fa: number,
  fb: number,
  tol: number,
): number {
  if (fa === 0) return a;
  if (fb === 0) return b;
  if ((fa < 0) === (fb < 0)) throw new EventError(`Brent: root not bracketed on [${a}, ${b}] (fa=${fa}, fb=${fb})`);

  let aa = a;
  let bb = b;
  let faa = fa;
  let fbb = fb;
  if (Math.abs(faa) < Math.abs(fbb)) {
    [aa, bb] = [bb, aa];
    [faa, fbb] = [fbb, faa];
  }
  let c = aa;
  let fc = faa;
  let mflag = true;
  let d = c;

  for (let iter = 0; iter < 100; iter++) {
    if (fbb === 0 || Math.abs(bb - aa) < tol) return bb;
    let s: number;
    if (faa !== fc && fbb !== fc) {
      // Inverse quadratic interpolation.
      s =
        (aa * fbb * fc) / ((faa - fbb) * (faa - fc)) +
        (bb * faa * fc) / ((fbb - faa) * (fbb - fc)) +
        (c * faa * fbb) / ((fc - faa) * (fc - fbb));
    } else {
      // Secant.
      s = bb - fbb * ((bb - aa) / (fbb - faa));
    }
    const lo = (3 * aa + bb) / 4;
    const cond1 = !((s > Math.min(lo, bb) && s < Math.max(lo, bb)));
    const cond2 = mflag && Math.abs(s - bb) >= Math.abs(bb - c) / 2;
    const cond3 = !mflag && Math.abs(s - bb) >= Math.abs(c - d) / 2;
    const cond4 = mflag && Math.abs(bb - c) < tol;
    const cond5 = !mflag && Math.abs(c - d) < tol;
    if (cond1 || cond2 || cond3 || cond4 || cond5) {
      s = (aa + bb) / 2; // bisection fallback
      mflag = true;
    } else {
      mflag = false;
    }
    const fs = f(s);
    d = c;
    c = bb;
    fc = fbb;
    if ((faa < 0) !== (fs < 0)) {
      bb = s;
      fbb = fs;
    } else {
      aa = s;
      faa = fs;
    }
    if (Math.abs(faa) < Math.abs(fbb)) {
      [aa, bb] = [bb, aa];
      [faa, fbb] = [fbb, faa];
    }
  }
  throw new EventError(`Brent: failed to converge on [${a}, ${b}] within 100 iterations`);
}
