// The access engine wired as a job (M-0004): one intervals product, one
// timeline lane per target, streamed target by target so windows draw onto
// their lanes as the sweep advances (docs/design/03 section 6). The engine
// itself is untouched; this adapter drives @bessel/access per target and the
// runner stamps the provenance. Correction is explicit and required on the
// request, never defaulted (M-0002), and is threaded to every computeAccess
// call; the internal geometry runs in J2000, which is what the provenance
// frame records.

import { computeAccess, type AccessConstraint } from '@bessel/access';
import type { Correction, Et } from '@cosmolabe/frames';
import type { EngineJob } from './job.ts';
import type { IntervalSet, Product } from './product.ts';

export interface AccessJobRequest {
  readonly observer: string;
  /** One timeline lane per target, streamed in this order. */
  readonly targets: readonly string[];
  readonly span: readonly [Et, Et];
  /** Geometry-finder search step (s); shorter than the briefest event. */
  readonly step: number;
  readonly constraints: readonly AccessConstraint[];
  /** Explicit at every call site, never defaulted (M-0002). */
  readonly correction: Correction;
}

const ACCESS_ENGINE_VERSION = '0.0.0'; // @bessel/access package version

export function accessJob(req: AccessJobRequest): EngineJob {
  if (req.targets.length === 0) {
    throw new Error('accessJob: at least one target is required');
  }
  return {
    engine: 'access',
    version: ACCESS_ENGINE_VERSION,
    frame: 'J2000',
    correction: req.correction,
    units: { intervals: 's (ET, TDB seconds past J2000)' },
    async *run(ctx) {
      const sets: IntervalSet[] = [];
      const product = (): Product => ({ kind: 'intervals', sets: [...sets] });
      for (let i = 0; i < req.targets.length; i++) {
        ctx.throwIfCancelled();
        const target = req.targets[i]!;
        const window = await computeAccess(ctx.engine, {
          observer: req.observer,
          target,
          span: req.span,
          step: req.step,
          constraints: req.constraints,
          abcorr: req.correction,
        });
        sets.push({ label: target, intervals: window.map(([a, b]) => [a, b] as const) });
        yield { pct: (100 * (i + 1)) / req.targets.length, partial: product() };
      }
      return product();
    },
  };
}
