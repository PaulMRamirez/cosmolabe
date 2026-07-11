// Shared building blocks for the re-slotted analysis domain panels (Phase 0.2). The
// former monolithic AnalysisPanel is split into intent-named domain panels (lighting,
// access/comms, conjunction, coverage, orbit/maneuver); this module holds the pieces
// those panels share: the per-tool Action button, the Keep-for-compare button, the
// coverage figure-of-merit note, the worker catalog screen, and the shared-context
// params hook that drives span/step/target/secondary. Presentational; no engine geometry.

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@bessel/selene-design';
import { tableToCsv } from '@bessel/interop';
import {
  useStore,
  KEPT_SNAPSHOT_LIMIT,
  type AppStore,
  type RunStatus,
  type AccessFom,
  type LinkBudgetParams,
} from '../store/index.ts';

/** Localized number format shared by the analysis panels (finite -> grouped, else '-'). */
export const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

/** Comment-preamble lines recording the radio parameters a link run used, so the
 *  exported Eb/N0 series is reproducible. Empty when no run has stored params. */
export function linkParamsPreamble(p: LinkBudgetParams | null): string {
  if (!p) return '';
  return (
    [
      `# link_eirp_dBW: ${p.eirpDbW}`,
      `# link_freq_GHz: ${p.freqHz / 1e9}`,
      `# link_g_over_t_dBK: ${p.gOverTDbK}`,
      `# link_data_rate_bps: ${p.dataRateBps}`,
    ].join('\n') + '\n#\n'
  );
}

/** The coverage figure-of-merit note shared by the interval tools (access, in-FOV):
 *  "<verb> N%, M <noun>(s), max gap K min". Null when there is no result yet. */
export function FomNote(props: {
  readonly fom: AccessFom | null | undefined;
  readonly verb: string;
  readonly noun: string;
  readonly plural: string;
  readonly testId: string;
}): JSX.Element | null {
  const { fom } = props;
  if (!fom) return null;
  return (
    <p className="bessel-analysis-stat" data-testid={props.testId}>
      {props.verb} {fmt(fom.percentCoverage * 100, 1)}%, {fom.accessCount} {props.noun}
      {fom.accessCount === 1 ? '' : props.plural}, max gap {fmt(fom.maxGapSec / 60, 1)} min
    </p>
  );
}

/** A panel action button (selene). While its tool is running it disables and reads
 *  "Computing...", driven by the per-tool run status. */
export function Action(props: {
  onClick: () => void;
  testId: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  status?: RunStatus;
  disabled?: boolean;
}): JSX.Element {
  const busy = props.status === 'running';
  const variant = props.variant ?? 'secondary';
  return (
    <Button
      variant={variant}
      full
      testId={props.testId}
      // The primary action carries a marker class so the TaskCard's Cmd/Ctrl+Enter
      // re-run can find and trigger it without threading a handler through children.
      className={variant === 'primary' ? 'bessel-card-action' : undefined}
      disabled={busy || !!props.disabled}
      onClick={props.onClick}
    >
      {busy ? 'Computing...' : props.children}
    </Button>
  );
}

/** A "Keep for compare" button that snapshots a result into the compare tray. The `domain` drives
 *  the testid (keep-<domain>) so every result block's Keep affordance is addressable; pass a
 *  distinct `domain` per result block within a panel (e.g. keep-lighting-beta, keep-access-passes). */
export function Keep(props: { domain: string; disabled: boolean; onKeep: () => void }): JSX.Element {
  return (
    <Button variant="ghost" testId={`keep-${props.domain}`} disabled={props.disabled} onClick={props.onKeep}>
      Keep for compare
    </Button>
  );
}

// [ux-p1-conjunction] The synthetic CatalogScreen component was removed: the Conjunction tab's
// screen now runs over a REAL ingested catalog and lives in the conjunction/ subpanels
// (CatalogIngestCard + PcCard), keeping the screen-catalog/progress/cancel testid family.

/** The shared-context state + derived run parameters every span-based analysis card reads.
 *  Hoisted out of the domain panels so the span/step/target/secondary controls and the
 *  reproducible CSV run-metadata are defined once. `paramsBar` is the rendered control
 *  block (with the use-shared toggle); the rest are the derived values the cards consume. */
export interface AnalysisParams {
  readonly paramsBar: JSX.Element;
  readonly span: { spanSec: number; stepSec: number };
  readonly targetSpan: { spanSec: number; stepSec: number; target?: string };
  readonly runMeta: Record<string, string | undefined>;
  readonly scalarCsv: (rows: readonly (readonly (string | number)[])[]) => string;
  readonly secondary: string;
}

/** Build the shared-context params for a domain panel. `withSecondary` adds the
 *  conjunction-only secondary select; `withTarget` adds the range/access target select
 *  in the override block. The toggle + indicator testids are preserved verbatim. */
export function useAnalysisParams(
  store: AppStore,
  opts: { withTarget: boolean; withSecondary: boolean },
): AnalysisParams {
  const objects = useStore(store, (s) => s.objects);
  const names = useMemo(() => objects.map((o) => o.name), [objects]);
  const ctx = useStore(store, (s) => s.analysisContext);
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const timeSystem = useStore(store, (s) => s.timeSystem);

  const [useShared, setUseShared] = useState(true);
  const [spanDays, setSpanDays] = useState(1);
  const [stepSec, setStepSec] = useState(120);
  const [target, setTarget] = useState('');
  const [secondary, setSecondary] = useState('');

  const effSpanSec = useShared ? ctx.spanSec : Math.max(60, spanDays * 86400);
  const effStepSec = useShared ? ctx.stepSec : Math.max(1, stepSec);
  const effTarget = useShared ? ctx.target : target;
  const span = { spanSec: effSpanSec, stepSec: effStepSec };
  const targetSpan = { ...span, ...(effTarget ? { target: effTarget } : {}) };

  const runMeta = useMemo(
    () => ({
      epoch: epochLabel || undefined,
      timeSystem,
      frame: useShared ? ctx.frame : 'J2000',
      span: `${(effSpanSec / 86400).toFixed(2)} d`,
      step: `${effStepSec} s`,
      ...(effTarget ? { target: effTarget } : {}),
      ...(secondary ? { secondary } : {}),
    }),
    [epochLabel, timeSystem, useShared, ctx.frame, effSpanSec, effStepSec, effTarget, secondary],
  );

  const scalarCsv = (rows: readonly (readonly (string | number)[])[]): string =>
    tableToCsv(['quantity', 'value'], rows, { meta: runMeta });

  const paramsBar = (
    <div className="bessel-analysis-params" data-testid="analysis-params">
      <label className="bessel-shared-toggle">
        <input
          type="checkbox"
          checked={useShared}
          onChange={(ev) => setUseShared(ev.target.checked)}
          data-testid="analysis-use-shared"
        />
        Use shared context
      </label>
      {useShared ? (
        <p className="bessel-loader-hint" data-testid="analysis-shared-indicator">
          Using shared context: {(ctx.spanSec / 86400).toFixed(2)} d span, {ctx.stepSec} s step
          {ctx.target ? `, target ${ctx.target}` : ''}.
        </p>
      ) : (
        <>
          <label>
            Span (days)
            <input
              type="number"
              min={0.01}
              step={0.5}
              value={spanDays}
              onChange={(ev) => setSpanDays(Math.max(0.01, Number(ev.target.value)))}
              data-testid="param-span-days"
            />
          </label>
          <label>
            Step (s)
            <input
              type="number"
              min={1}
              value={stepSec}
              onChange={(ev) => setStepSec(Math.max(1, Number(ev.target.value)))}
              data-testid="param-step-sec"
            />
          </label>
          {opts.withTarget ? (
            <label>
              Target (range/access)
              <select value={target} onChange={(ev) => setTarget(ev.target.value)} data-testid="param-target">
                <option value="">(default)</option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      )}
      {opts.withSecondary ? (
        <label>
          Secondary (conjunction)
          <select value={secondary} onChange={(ev) => setSecondary(ev.target.value)} data-testid="param-secondary">
            <option value="">(center body)</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  return { paramsBar, span, targetSpan, runMeta, scalarCsv, secondary };
}

/** The "load a spacecraft" notice shown above a domain panel's tools when no spacecraft
 *  is loaded (the tools still run on sample data). Preserves the analysis-empty-notice id. */
export function EmptyNotice(props: { hasSpacecraft: boolean }): JSX.Element | null {
  if (props.hasSpacecraft) return null;
  return (
    <p className="bessel-loader-hint" data-testid="analysis-empty-notice">
      Load a spacecraft to analyze. Tools below run on sample data.
    </p>
  );
}

/** Whether the kept-snapshot compare tray is full (shared by the Keep buttons). */
export function useTrayFull(store: AppStore): boolean {
  return useStore(store, (s) => s.keptSnapshots.length) >= KEPT_SNAPSHOT_LIMIT;
}
