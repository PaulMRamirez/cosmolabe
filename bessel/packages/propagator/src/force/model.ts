// Compose force terms into a force model: the acceleration is the vector sum of every
// term, evaluated in the central-body inertial frame. The variational channel sums
// each term's acceleration partials da/dr (and da/dv), central-differencing any term
// that lacks an analytic partials() so analytic terms stay exact. (STK_PARITY_SPEC §4.2.)

import { StmUnsupportedError } from '../errors.ts';
import type { AccelPartials, ForceContext, ForceModel, ForceTerm, Mat3, Vector3 } from './types.ts';

const ctxAt = (r: Vector3, ctx: ForceContext): ForceContext => ({ et: ctx.et, r, v: ctx.v });

/**
 * Central-difference one term's acceleration to a 3x3 da/dr. Step scaled to |r| at the
 * truncation/cancellation sweet spot for O(delta^2) central differences in float64.
 */
function fdPartials(term: ForceTerm, ctx: ForceContext): AccelPartials {
  const [x, y, z] = ctx.r;
  const base = [x, y, z];
  const cbrtEps = Math.cbrt(Number.EPSILON);
  const dadr = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    const delta = Math.max(1, Math.abs(base[j]!)) * cbrtEps;
    const plus: [number, number, number] = [base[0]!, base[1]!, base[2]!];
    const minus: [number, number, number] = [base[0]!, base[1]!, base[2]!];
    plus[j] = base[j]! + delta;
    minus[j] = base[j]! - delta;
    const ap = term.acceleration(ctxAt(plus, ctx));
    const am = term.acceleration(ctxAt(minus, ctx));
    for (let i = 0; i < 3; i++) dadr[i * 3 + j] = (ap[i]! - am[i]!) / (2 * delta);
  }
  return { dadr: dadr as unknown as Mat3 };
}

export function createForceModel(terms: readonly ForceTerm[]): ForceModel {
  return {
    terms,
    acceleration(ctx: ForceContext): Vector3 {
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const term of terms) {
        const a = term.acceleration(ctx);
        ax += a[0];
        ay += a[1];
        az += a[2];
      }
      return [ax, ay, az];
    },
    partials(ctx: ForceContext, fdFallback = true): AccelPartials {
      const dadr = new Array<number>(9).fill(0);
      const dadv = new Array<number>(9).fill(0);
      let anyDadv = false;
      for (const term of terms) {
        let p: AccelPartials;
        if (term.partials) {
          p = term.partials(ctx);
        } else if (fdFallback) {
          p = fdPartials(term, ctx);
        } else {
          throw new StmUnsupportedError(term.name);
        }
        for (let i = 0; i < 9; i++) dadr[i]! += p.dadr[i]!;
        if (p.dadv) {
          anyDadv = true;
          for (let i = 0; i < 9; i++) dadv[i]! += p.dadv[i]!;
        }
      }
      return anyDadv
        ? { dadr: dadr as unknown as Mat3, dadv: dadv as unknown as Mat3 }
        : { dadr: dadr as unknown as Mat3 };
    },
  };
}
