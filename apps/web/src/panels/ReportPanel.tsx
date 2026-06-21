// The data-provider workbench: pick a registered provider (range, position, sub-point,
// ...) for an observer/target pair over a time grid, run it as one F3 evalSeries job,
// and read the unit-tagged report table; export the full series as CSV. This is the
// configurable generalization of the fixed analysis buttons. (STK_PARITY_SPEC §4.10.)

import { useMemo, useState } from 'react';
import { Button } from '@bessel/selene-design';
import { ReportTable, downloadBlob } from '@bessel/ui';
import { seriesToCsv } from '@bessel/interop';
import { PROVIDER_CATALOG, type ProviderKind } from '@bessel/spice';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';

export interface ReportPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

export function ReportPanel(props: ReportPanelProps): JSX.Element {
  const { engine, store } = props;
  const objects = useStore(store, (s) => s.objects);
  const report = useStore(store, (s) => s.report);

  const names = useMemo(() => objects.map((o) => o.name), [objects]);
  const [kind, setKind] = useState<ProviderKind>('range');
  const [observer, setObserver] = useState(names[0] ?? 'Sun');
  const [target, setTarget] = useState(names[1] ?? names[0] ?? 'Earth');
  const [frame, setFrame] = useState('J2000');
  const [durationMin, setDurationMin] = useState(60);
  const [stepS, setStepS] = useState(60);

  const run = (): void =>
    void engine?.runReport({
      kind,
      observer,
      target,
      frame,
      durationS: durationMin * 60,
      stepS,
    });

  const exportCsv = (): void => {
    if (!report) return;
    const csv = seriesToCsv(report.series.et, report.series.columns, report.series.names, {
      epochHeader: 'et',
      meta: {
        timeSystem: 'UTC',
        frame,
        span: `${durationMin} min`,
        step: `${stepS} s`,
        target,
        secondary: observer,
      },
    });
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'report.csv');
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
      <label>
        Observer
        <select value={observer} onChange={(e) => setObserver(e.target.value)} data-testid="report-observer">
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target
        <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="report-target">
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
      <Button variant="primary" full testId="run-report" onClick={run}>
        Run report
      </Button>
      {report ? (
        <div data-testid="report-result">
          <div className="bessel-panel-title">{report.label}</div>
          <ReportTable columns={report.headers} rows={report.rows} testId="report-table" />
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
