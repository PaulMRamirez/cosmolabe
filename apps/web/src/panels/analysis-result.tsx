// The analysis result blocks, extracted from AnalysisPanel so the panel stays under
// the soft cap and the table/copy/precision plumbing lives in one place. Each result
// renders through ResultView, which adds a chart/table toggle, a copy-to-clipboard
// button (loud on failure), and a significant-digits selector. Presentational.

import { useState, type ReactNode } from 'react';
import { Button } from '@bessel/selene-design';
import {
  IntervalTimeline,
  ReportTable,
  TimeSeriesChart,
  downloadBlob,
  reportToText,
} from '@bessel/ui';
import type { Series } from '../store/index.ts';

export type Intervals = readonly (readonly [number, number])[];

/** Download a CSV string as a file. */
function exportCsv(filename: string, csv: string): void {
  downloadBlob(new Blob([csv], { type: 'text/csv' }), filename);
}

/** A small "Export CSV" button used under each analysis result. */
function CsvButton(props: { onClick: () => void; testId: string }): JSX.Element {
  return (
    <Button variant="secondary" testId={props.testId} className="bessel-csv-button" onClick={props.onClick}>
      Export CSV
    </Button>
  );
}

const PRECISIONS = [3, 4, 6, 9] as const;

type Rows = readonly (readonly (string | number)[])[];

/** A result body: a chart by default, or the underlying rows as a copyable table. */
function ResultView(props: {
  chart: ReactNode;
  columns: readonly string[];
  rows: Rows;
  baseTestId: string;
  tableTestId: string;
}): JSX.Element {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  const [precision, setPrecision] = useState(6);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const copy = (): void => {
    const text = reportToText(props.columns, props.rows, precision);
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
    <>
      <div className="bessel-result-toolbar" data-testid={`${props.baseTestId}-toolbar`}>
        <Button
          variant={mode === 'chart' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'chart'}
          testId={`${props.baseTestId}-view-chart`}
          onClick={() => setMode('chart')}
        >
          Chart
        </Button>
        <Button
          variant={mode === 'table' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'table'}
          testId={`${props.baseTestId}-view-table`}
          onClick={() => setMode('table')}
        >
          Table
        </Button>
        <Button variant="secondary" testId={`${props.baseTestId}-copy`} onClick={copy}>
          {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy'}
        </Button>
        <label>
          Digits
          <select
            value={precision}
            data-testid={`${props.baseTestId}-precision`}
            onChange={(ev) => setPrecision(Number(ev.target.value))}
          >
            {PRECISIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mode === 'chart' ? (
        props.chart
      ) : (
        <ReportTable
          columns={props.columns}
          rows={props.rows}
          precision={precision}
          testId={props.tableTestId}
        />
      )}
    </>
  );
}

/** A time-series analysis result block: title + chart/table + optional CSV, or a hint. */
export function SeriesResult(props: {
  series: Series | null;
  resultTestId: string;
  chartTestId: string;
  hint: string;
  csv?: { testId: string; filename: string; build: (s: Series) => string };
}): JSX.Element {
  const { series, csv } = props;
  if (!series) return <p className="bessel-loader-hint">{props.hint}</p>;
  const columns = ['et (s)', series.label];
  const rows = Array.from(series.et, (t, i) => [t, series.value[i] ?? Number.NaN] as const);
  return (
    <div data-testid={props.resultTestId}>
      <div className="bessel-panel-title">{series.label}</div>
      <ResultView
        baseTestId={props.resultTestId}
        tableTestId={`${props.resultTestId}-table`}
        columns={columns}
        rows={rows}
        chart={
          <TimeSeriesChart
            et={series.et}
            value={series.value}
            label={series.label}
            testId={props.chartTestId}
          />
        }
      />
      {csv ? <CsvButton testId={csv.testId} onClick={() => exportCsv(csv.filename, csv.build(series))} /> : null}
    </div>
  );
}

/** An interval (Gantt) analysis result block: title + timeline/table + optional CSV/extra. */
export function IntervalResult(props: {
  intervals: Intervals | null;
  span: readonly [number, number] | null;
  title: string;
  label: string;
  resultTestId: string;
  timelineTestId: string;
  hint: string;
  csv?: { testId: string; filename: string; build: (i: Intervals) => string };
  extra?: ReactNode;
}): JSX.Element {
  const { intervals, span, csv } = props;
  if (!intervals || !span) return <p className="bessel-loader-hint">{props.hint}</p>;
  const columns = ['start (et s)', 'stop (et s)', 'duration (s)'];
  const rows = intervals.map(([a, b]) => [a, b, b - a] as const);
  return (
    <div data-testid={props.resultTestId}>
      <div className="bessel-panel-title">{props.title}</div>
      <ResultView
        baseTestId={props.resultTestId}
        tableTestId={`${props.resultTestId}-table`}
        columns={columns}
        rows={rows}
        chart={
          <IntervalTimeline
            intervals={intervals}
            span={span}
            label={props.label}
            testId={props.timelineTestId}
          />
        }
      />
      {csv ? <CsvButton testId={csv.testId} onClick={() => exportCsv(csv.filename, csv.build(intervals))} /> : null}
      {props.extra}
    </div>
  );
}

/** A scalar-readout result: a stat paragraph (with optional CSV) when present, else a hint.
 *  The CSV `build` is a thunk because a scalar result has no array to pass. */
export function StatResult(props: {
  show: boolean;
  resultTestId: string;
  hint: string;
  children: ReactNode;
  csv?: { testId: string; filename: string; build: () => string };
}): JSX.Element {
  const { csv } = props;
  if (!props.show) return <p className="bessel-loader-hint">{props.hint}</p>;
  return (
    <>
      <p className="bessel-analysis-stat" data-testid={props.resultTestId}>
        {props.children}
      </p>
      {csv ? <CsvButton testId={csv.testId} onClick={() => exportCsv(csv.filename, csv.build())} /> : null}
    </>
  );
}

/** A standalone "Export CSV" button for a result that renders its own body (e.g. the
 *  ground-track map), where SeriesResult/IntervalResult/StatResult are not used. */
export function ResultCsv(props: { testId: string; filename: string; build: () => string }): JSX.Element {
  return <CsvButton testId={props.testId} onClick={() => exportCsv(props.filename, props.build())} />;
}
