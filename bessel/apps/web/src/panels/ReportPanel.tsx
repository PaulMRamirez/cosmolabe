// The data-provider workbench: pick a registered provider (range, position, sub-point,
// ...) for an observer/target pair over a time grid, run it as one F3 evalSeries job,
// and read the unit-tagged report table; export the full series as CSV. This is the
// configurable generalization of the fixed analysis buttons. (STK_PARITY_SPEC §4.10.)

import { useMemo, useState } from 'react';
import { Button } from '@bessel/selene-design';
import { ReportTable, downloadBlob, reportToText } from '@bessel/ui';
import { seriesToCsv } from '@bessel/interop';
import { PROVIDER_CATALOG, type ProviderKind } from '@bessel/spice';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { RunStatusNote, busyLabel } from './RunStatus.tsx';
// The same significant-digits choices the analysis-result toolbar offers, so the report
// table reads consistently with the other result views.
import { PRECISIONS } from './analysis-result.tsx';

export interface ReportPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

/**
 * Clamp a remembered selection against the current option names. The local
 * observer/target selects capture a default only at first mount; after loading a
 * different mission the held name can be absent from the new options, so Run would
 * submit a stale pair. Keep the selection when it still exists, otherwise fall back to
 * the name at `fallbackIndex` (then the first name, then the given default), never a
 * name that is not in the list.
 */
export function reconcileName(
  selected: string,
  names: readonly string[],
  fallbackIndex: number,
  dflt: string,
): string {
  if (names.includes(selected)) return selected;
  return names[fallbackIndex] ?? names[0] ?? dflt;
}

export function ReportPanel(props: ReportPanelProps): JSX.Element {
  const { engine, store } = props;
  const objects = useStore(store, (s) => s.objects);
  const report = useStore(store, (s) => s.report);

  const ctx = useStore(store, (s) => s.analysisContext);
  const runStatus = useStore(store, (s) => s.runStatus);
  const names = useMemo(() => objects.map((o) => o.name), [objects]);
  const runBtn = busyLabel(runStatus['run-report'], 'Run report', 'Computing...');
  const [useShared, setUseShared] = useState(true);
  const [kind, setKind] = useState<ProviderKind>('range');
  const [observer, setObserver] = useState(names[0] ?? 'Sun');
  const [target, setTarget] = useState(names[1] ?? names[0] ?? 'Earth');
  const [frame, setFrame] = useState('J2000');
  const [durationMin, setDurationMin] = useState(60);
  const [stepS, setStepS] = useState(60);
  const [precision, setPrecision] = useState(6);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  // The observer/target pair, frame, and grid come from the shared context by default;
  // the override reveals the local inputs. The provider kind is always tool-local.
  // In local mode the held observer/target may name an object from a previously loaded
  // mission; reconcile against the current names so Run never submits a stale pair.
  const effObserver = useShared ? ctx.observer || names[0] || 'Sun' : reconcileName(observer, names, 0, 'Sun');
  const effTarget = useShared ? ctx.target || names[1] || names[0] || 'Earth' : reconcileName(target, names, 1, 'Earth');
  const effFrame = useShared ? ctx.frame : frame;
  const effDurationS = useShared ? ctx.spanSec : durationMin * 60;
  const effStepS = useShared ? ctx.stepSec : stepS;

  const run = (): void =>
    void engine?.runReport({
      kind,
      observer: effObserver,
      target: effTarget,
      frame: effFrame,
      durationS: effDurationS,
      stepS: effStepS,
    });

  const exportCsv = (): void => {
    if (!report) return;
    const csv = seriesToCsv(report.series.et, report.series.columns, report.series.names, {
      epochHeader: 'et',
      meta: {
        timeSystem: 'UTC',
        frame: effFrame,
        span: `${(effDurationS / 60).toFixed(0)} min`,
        step: `${effStepS} s`,
        target: effTarget,
        secondary: effObserver,
      },
    });
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'report.csv');
  };

  const copy = (): void => {
    if (!report) return;
    const text = reportToText(report.headers, report.rows, precision);
    void (async () => {
      try {
        await navigator.clipboard?.writeText(text);
        setCopyState(navigator.clipboard ? 'ok' : 'fail');
      } catch {
        setCopyState('fail');
      }
    })();
  };

  return (
    <div className="bessel-report-form" data-testid="report-panel">
      <label>
        Provider
        <select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)} data-testid="report-provider">
          {PROVIDER_CATALOG.map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label} ({p.unit})
            </option>
          ))}
        </select>
      </label>
      <label className="bessel-shared-toggle">
        <input
          type="checkbox"
          checked={useShared}
          onChange={(e) => setUseShared(e.target.checked)}
          data-testid="report-use-shared"
        />
        Use shared context
      </label>
      {useShared ? (
        <p className="bessel-loader-hint" data-testid="report-shared-indicator">
          Using shared context: {effObserver} to {effTarget}, {effFrame},{' '}
          {(effDurationS / 60).toFixed(0)} min at {effStepS} s.
        </p>
      ) : (
        <>
          <label>
            Observer
            <select value={effObserver} onChange={(e) => setObserver(e.target.value)} data-testid="report-observer">
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target
            <select value={effTarget} onChange={(e) => setTarget(e.target.value)} data-testid="report-target">
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frame
            <input value={frame} onChange={(e) => setFrame(e.target.value)} data-testid="report-frame" />
          </label>
          <div className="bessel-report-grid-inputs">
            <label>
              Duration (min)
              <input
                type="number"
                value={durationMin}
                min={1}
                max={1440}
                onChange={(e) => setDurationMin(Math.min(1440, Math.max(1, Number(e.target.value))))}
                data-testid="report-duration"
              />
            </label>
            <label>
              Step (s)
              <input
                type="number"
                value={stepS}
                min={1}
                onChange={(e) => setStepS(Math.max(1, Number(e.target.value)))}
                data-testid="report-step"
              />
            </label>
          </div>
        </>
      )}
      <Button variant="primary" full testId="run-report" disabled={runBtn.disabled} onClick={run}>
        {runBtn.label}
      </Button>
      <RunStatusNote status={runStatus['run-report']} id="run-report" />
      {report ? (
        <div data-testid="report-result">
          <div className="bessel-panel-title">{report.label}</div>
          <div className="bessel-result-toolbar" data-testid="report-result-toolbar">
            <Button variant="secondary" testId="report-copy" onClick={copy}>
              {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy'}
            </Button>
            <label>
              Digits
              <select
                value={precision}
                data-testid="report-digits"
                onChange={(e) => setPrecision(Number(e.target.value))}
              >
                {PRECISIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ReportTable columns={report.headers} rows={report.rows} precision={precision} testId="report-table" />
          <Button variant="secondary" className="bessel-csv-button" testId="report-csv" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      ) : (
        <p className="bessel-loader-hint">Pick a provider and an observer/target pair, then run a report.</p>
      )}
    </div>
  );
}
