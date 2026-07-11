// A scalar geometry finder: given a constraint function g(et) (access where g >= 0),
// scan a uniform grid for sign changes and refine each crossing by bisection,
// assembling the satisfied intervals into a Window. This is the shared searcher
// behind derived-constraint analyses (facility elevation, pointing keep-out, ...): one
// searcher, many constraint functions (the CSPICE GF pattern). (STK_PARITY_SPEC §4.3.)

import { windowFromIntervals, type Window } from './window.ts';
import { type EphemerisTime } from './index.ts';

/** A constraint scalar at an epoch; the access window is where it is >= 0. */
export type ConstraintFn = (et: EphemerisTime) => Promise<number>;

/**
 * Find the Window over [span] where `g(et) >= 0`, sampling at `step` and refining each
 * sign change to ~1e-3 s by bisection. `g` is evaluated once per sample plus a bounded
 * number of times per crossing.
 */
export async function findConstraintWindow(
  g: ConstraintFn,
  span: readonly [EphemerisTime, EphemerisTime],
  step: number,
): Promise<Window> {
  const [t0, t1] = span;

  const refine = async (lo: number, hi: number, gLo: number): Promise<number> => {
    let a = lo;
    let b = hi;
    let ga = gLo;
    for (let i = 0; i < 40 && b - a > 1e-3; i++) {
      const m = (a + b) / 2;
      const gm = await g(m);
      if (gm === 0) return m;
      if (ga < 0 === gm < 0) {
        a = m;
        ga = gm;
      } else {
        b = m;
      }
    }
    return (a + b) / 2;
  };

  const intervals: [number, number][] = [];
  let prevEt = t0;
  let prevG = await g(t0);
  let openStart = prevG >= 0 ? t0 : null;
  for (let et = t0 + step; et <= t1 + step / 2; et += step) {
    const cur = Math.min(et, t1);
    const curG = await g(cur);
    if (prevG < 0 && curG >= 0) {
      openStart = await refine(prevEt, cur, prevG); // rise
    } else if (prevG >= 0 && curG < 0 && openStart !== null) {
      intervals.push([openStart, await refine(prevEt, cur, prevG)]); // set
      openStart = null;
    }
    prevEt = cur;
    prevG = curG;
  }
  if (openStart !== null) intervals.push([openStart, t1]);
  return windowFromIntervals(intervals);
}
