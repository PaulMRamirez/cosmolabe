// The Lighting & Geometry TaskCard bodies (analysis-UX Phase 1). Split out of
// LightingGeometryPanel so the panel stays under the soft cap while each lighting
// capability (beta season, full eclipse phases, solar intensity) renders as an
// intent-framed card: purpose, run action, an inline result with units + a
// threshold/interpretation hint, and CSV export via the shared result components.
// Presentational only: each card reads a result slice and calls the engine.

import { type ReactNode } from 'react';
import { seriesToCsv, intervalsToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import {
  type BetaSeriesResult,
  type EclipsePhasesResult,
  type RunStatus,
  type Series,
} from '../store/index.ts';
import { IntervalResult, SeriesResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { Action, Keep, fmt } from './analysis-shared.tsx';
import type { SnapshotKind } from '../engine/snapshot-metrics.ts';

type Meta = Record<string, string | undefined>;

interface CardCtx {
  readonly engine: BesselEngine | null;
  readonly span: { spanSec: number; stepSec: number };
  readonly runStatus: Readonly<Record<string, RunStatus>>;
  readonly runMeta: Meta;
  /** Whether the compare tray is full, so the Keep affordances disable at the cap. */
  readonly trayFull: boolean;
}

/** Shared shape of the two series-based lighting cards (beta, solar intensity): a run
 *  action, a SeriesResult plot/CSV, an interpretation note, and a located run-status note.
 *  `id` is the tool/run-status id (also the testid stem); `column` is the CSV value name. */
function seriesLightingCard(opts: {
  readonly ctx: CardCtx;
  /** The run-status / action testid (e.g. "compute-beta"). */
  readonly id: string;
  /** The result/chart/csv testid stem (e.g. "beta"), kept stable across the refactor. */
  readonly stem: string;
  readonly run: () => void;
  readonly action: string;
  readonly primary?: boolean;
  readonly series: Series | null;
  readonly hint: string;
  readonly column: string;
  readonly note?: ReactNode;
  /** The keep-for-compare affordance: its testid domain stem + the snapshot kind to keep. */
  readonly keep: { readonly domain: string; readonly kind: SnapshotKind; readonly present: boolean };
}): ReactNode {
  const { ctx, id, stem, keep } = opts;
  const status = ctx.runStatus[id];
  return (
    <>
      <Action variant={opts.primary ? 'primary' : 'secondary'} status={status} onClick={opts.run} testId={id}>
        {opts.action}
      </Action>
      <SeriesResult
        series={opts.series}
        resultTestId={`${stem}-result`}
        chartTestId={`${stem}-chart`}
        hint={opts.hint}
        csv={{
          testId: `${stem}-csv`,
          filename: `${stem}.csv`,
          build: (s) => seriesToCsv(s.et, [s.value], [opts.column], { meta: ctx.runMeta }),
        }}
      />
      {opts.series ? opts.note : null}
      <RunStatusNote status={status} id={id} />
      <Keep domain={keep.domain} disabled={!keep.present || ctx.trayFull} onKeep={() => ctx.engine?.keepSnapshot(keep.kind)} />
    </>
  );
}

/** Beta-angle season card: plot beta (deg) over the span and annotate the eclipse-onset
 *  threshold (|beta| below it puts the orbit in eclipse season). */
export function betaCard(ctx: CardCtx, beta: BetaSeriesResult | null): ReactNode {
  return seriesLightingCard({
    ctx,
    id: 'compute-beta',
    stem: 'beta',
    run: () => void ctx.engine?.computeBetaSeries(ctx.span),
    action: 'Compute beta angle',
    primary: true,
    series: beta?.series ?? null,
    hint: 'Plot the solar beta angle over the span and mark the eclipse-onset threshold.',
    column: 'beta_deg',
    note: beta ? (
      <p className="bessel-analysis-stat" data-testid="beta-onset">
        Eclipse season while |beta| &lt; {fmt(beta.onsetDeg, 1)} deg (the orbit's eclipse-onset angle).
      </p>
    ) : null,
    keep: { domain: 'lighting-beta', kind: 'lighting-beta', present: !!beta },
  });
}

/** The four eclipse phases, in stacking order, each with its display title. */
const ECLIPSE_PHASES = [
  ['umbra', 'Umbra (total shadow)'],
  ['penumbra', 'Penumbra (partial)'],
  ['annular', 'Annular'],
  ['sunlit', 'Sunlit'],
] as const;

/** Full eclipse-phases card: a stacked umbra/penumbra/annular/sunlit interval timeline
 *  plus the per-day shadowed duration. Keeps the compute-eclipse + eclipse-result ids. */
export function eclipseCard(ctx: CardCtx, phases: EclipsePhasesResult | null): ReactNode {
  const status = ctx.runStatus['compute-eclipse'];
  return (
    <>
      <Action
        variant="primary"
        status={status}
        onClick={() => void ctx.engine?.computeEclipse(ctx.span)}
        testId="compute-eclipse"
      >
        Compute eclipse
      </Action>
      {phases ? (
        <div data-testid="eclipse-result">
          {ECLIPSE_PHASES.map(([phase, title]) => (
            <IntervalResult
              key={phase}
              intervals={phases[phase]}
              span={phases.span}
              title={title}
              label={title}
              resultTestId={`eclipse-${phase}-result`}
              timelineTestId={`eclipse-${phase}-timeline`}
              hint=""
              csv={{
                testId: `eclipse-${phase}-csv`,
                filename: `eclipse-${phase}.csv`,
                build: (i) => intervalsToCsv(i, { meta: ctx.runMeta }),
              }}
            />
          ))}
          <p className="bessel-analysis-stat" data-testid="eclipse-duration">
            Shadowed {fmt(phases.shadowSecPerDay / 60, 1)} min/day (umbra + penumbra + annular).
          </p>
        </div>
      ) : (
        <p className="bessel-loader-hint">
          Compute the umbra, penumbra, annular, and sunlit phases over the span.
        </p>
      )}
      <RunStatusNote status={status} id="compute-eclipse" />
      <Keep
        domain="lighting-eclipse"
        disabled={!phases || ctx.trayFull}
        onKeep={() => ctx.engine?.keepSnapshot('lighting-eclipse')}
      />
    </>
  );
}

/** Solar-intensity card: plot the visible solar-disk fraction (0..1) over the span,
 *  the power/thermal driver. 1 is full sun, 0 is total umbra. */
export function solarIntensityCard(ctx: CardCtx, series: Series | null): ReactNode {
  return seriesLightingCard({
    ctx,
    id: 'compute-solar-intensity',
    stem: 'solar-intensity',
    run: () => void ctx.engine?.computeSolarIntensity(ctx.span),
    action: 'Compute solar intensity',
    series,
    hint: "Plot the visible fraction of the Sun's disk (0..1) over the span.",
    column: 'visible_fraction',
    note: (
      <p className="bessel-analysis-stat" data-testid="solar-intensity-hint">
        1 = full sun, 0 = total umbra; values between are the penumbra fraction.
      </p>
    ),
    keep: { domain: 'lighting-solar', kind: 'lighting-solar', present: !!series },
  });
}
