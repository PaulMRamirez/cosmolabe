// The geometry emitter (M-0004, kind 'geometry'): a ground track from the
// sub-point path, wired as a job. The satellite's sub-observer point on the
// central body is sampled per epoch through the engine's subpnt (the
// sincpt-family surface geometry the design's footprint path names), and the
// polyline streams chunk by chunk so the drape draws on as the sweep
// advances. Positions are body-fixed kilometers in the request's body frame,
// which is also the provenance frame of record. Correction is explicit and
// required, never defaulted (M-0002).

import type { Correction, Et, FrameId, Seconds } from '@cosmolabe/frames';
import type { EngineJob } from './job.ts';
import type { GeoLayer, Product } from './product.ts';

export interface GroundTrackJobRequest {
  /** The central body whose surface carries the track (e.g. 'EARTH'). */
  readonly body: string;
  /** The satellite whose sub-point traces the track. */
  readonly satellite: string;
  /** The body-fixed frame of the positions (e.g. 'IAU_EARTH'). */
  readonly bodyFrame: FrameId;
  readonly span: readonly [Et, Et];
  readonly step: Seconds;
  /** Explicit at every call site, never defaulted (M-0002). */
  readonly correction: Correction;
  /** Partial cadence: the sweep is split into this many chunks (default 8). */
  readonly chunks?: number;
}

const GROUND_TRACK_ENGINE_VERSION = '0.0.0'; // engine subpnt surface

export function groundTrackJob(req: GroundTrackJobRequest): EngineJob {
  const [t0, t1] = req.span;
  if (!(t1 > t0)) throw new Error(`groundTrackJob: span must be increasing, got [${t0}, ${t1}]`);
  if (!(req.step > 0)) throw new Error(`groundTrackJob: step must be positive, got ${req.step}`);

  return {
    engine: 'groundTrack',
    version: GROUND_TRACK_ENGINE_VERSION,
    frame: req.bodyFrame,
    correction: req.correction,
    units: { positions: 'km' },
    async *run(ctx) {
      const n = Math.floor((t1 - t0) / req.step) + 1;
      const positions = new Float64Array(n * 3).fill(Number.NaN);
      const layer = (filled: number): GeoLayer => ({
        label: `${req.satellite} ground track on ${req.body}`,
        frame: req.bodyFrame,
        form: 'polyline',
        positions: positions.slice(0, filled * 3),
      });
      const product = (filled: number): Product => ({ kind: 'geometry', layers: [layer(filled)] });

      const chunkCount = Math.max(1, Math.min(req.chunks ?? 8, n));
      let filled = 0;
      for (let c = 0; c < chunkCount; c++) {
        const to = Math.floor(((c + 1) * n) / chunkCount);
        for (; filled < to; filled++) {
          ctx.throwIfCancelled();
          const sub = await ctx.engine.subpnt(
            'NEAR POINT/ELLIPSOID',
            req.body,
            t0 + filled * req.step,
            req.bodyFrame,
            req.correction,
            req.satellite,
          );
          positions[filled * 3] = sub.point.x;
          positions[filled * 3 + 1] = sub.point.y;
          positions[filled * 3 + 2] = sub.point.z;
        }
        yield { pct: (100 * filled) / n, partial: product(filled) };
      }
      return product(n);
    },
  };
}
