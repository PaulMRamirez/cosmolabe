// The analysis workbench surfaced in the viewer's Analysis menu. Each tool runs one
// validated core engine (events, access/coverage, rf, conjunction, attitude, mission,
// map-projection, interop) on the loaded spacecraft mission and renders the result
// through the @bessel/ui charting primitives. Presentational: it reads analysis
// slices from the store and calls engine methods; all geometry lives in the engine.
// (STK_PARITY_SPEC F5 / §4.)

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@bessel/selene-design';
import { GroundTrackMap, IntervalTimeline, TimeSeriesChart, downloadBlob } from '@bessel/ui';
import { seriesToCsv, intervalsToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore, type Series } from '../store/index.ts';

export interface AnalysisPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

/** Download a CSV string as a file. */
function exportCsv(filename: string, csv: string): void {
  downloadBlob(new Blob([csv], { type: 'text/csv' }), filename);
}

/** A primary panel action button (selene), preserving the data-testid test hook. */
function Action(props: {
  onClick: () => void;
  testId: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}): JSX.Element {
  return (
    <Button variant={props.variant ?? 'primary'} full testId={props.testId} onClick={props.onClick}>
      {props.children}
    </Button>
  );
}

/** A small "Export CSV" button used under each analysis result. */
function CsvButton(props: { onClick: () => void; testId: string }): JSX.Element {
  return (
    <Button variant="secondary" testId={props.testId} className="bessel-csv-button" onClick={props.onClick}>
      Export CSV
    </Button>
  );
}

/** A time-series analysis result block: title + chart + optional CSV, or a hint. */
function SeriesResult(props: {
  series: Series | null;
  resultTestId: string;
  chartTestId: string;
  hint: string;
  csv?: { testId: string; filename: string; build: (s: Series) => string };
}): JSX.Element {
  const { series, csv } = props;
  if (!series) return <p className="bessel-loader-hint">{props.hint}</p>;
  return (
    <div data-testid={props.resultTestId}>
      <div className="bessel-panel-title">{series.label}</div>
      <TimeSeriesChart et={series.et} value={series.value} label={series.label} testId={props.chartTestId} />
      {csv ? <CsvButton testId={csv.testId} onClick={() => exportCsv(csv.filename, csv.build(series))} /> : null}
    </div>
  );
}

type Intervals = readonly (readonly [number, number])[];

/** An interval (Gantt) analysis result block: title + timeline + optional CSV/extra, or a hint. */
function IntervalResult(props: {
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
  return (
    <div data-testid={props.resultTestId}>
      <div className="bessel-panel-title">{props.title}</div>
      <IntervalTimeline intervals={intervals} span={span} label={props.label} testId={props.timelineTestId} />
      {csv ? <CsvButton testId={csv.testId} onClick={() => exportCsv(csv.filename, csv.build(intervals))} /> : null}
      {props.extra}
    </div>
  );
}

/** A scalar-readout result: a stat paragraph when present, else a hint. */
function StatResult(props: { show: boolean; resultTestId: string; hint: string; children: ReactNode }): JSX.Element {
  return props.show ? (
    <p className="bessel-analysis-stat" data-testid={props.resultTestId}>
      {props.children}
    </p>
  ) : (
    <p className="bessel-loader-hint">{props.hint}</p>
  );
}

export function AnalysisPanel(props: AnalysisPanelProps): JSX.Element {
  const { engine, store } = props;
  const objects = useStore(store, (s) => s.objects);
  const names = useMemo(() => objects.map((o) => o.name), [objects]);

  // Shared analysis parameters: a time span and step the span-based tools use, an
  // optional target object for range/access, and a secondary object for conjunction.
  // Empty target/secondary mean "use the tool default" (center body or the Sun).
  const [spanDays, setSpanDays] = useState(1);
  const [stepSec, setStepSec] = useState(120);
  const [target, setTarget] = useState('');
  const [secondary, setSecondary] = useState('');
  const spanSec = Math.max(60, spanDays * 86400);
  const span = { spanSec, stepSec: Math.max(1, stepSec) };

  // Run-parameter metadata stamped onto every exported CSV so a result is reproducible.
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const runMeta = useMemo(
    () => ({
      epoch: epochLabel || undefined,
      timeSystem: 'UTC' as const,
      frame: 'J2000',
      span: `${spanDays} d`,
      step: `${Math.max(1, stepSec)} s`,
      ...(target ? { target } : {}),
      ...(secondary ? { secondary } : {}),
    }),
    [epochLabel, spanDays, stepSec, target, secondary],
  );
  const targetSpan = { ...span, ...(target ? { target } : {}) };

  const eclipseUmbra = useStore(store, (s) => s.eclipseUmbra);
  const eclipseSpan = useStore(store, (s) => s.eclipseSpan);
  const rangeSeries = useStore(store, (s) => s.rangeSeries);
  const accessWindow = useStore(store, (s) => s.accessWindow);
  const accessSpan = useStore(store, (s) => s.accessSpan);
  const accessLabel = useStore(store, (s) => s.accessLabel);
  const accessFom = useStore(store, (s) => s.accessFom);
  const linkSeries = useStore(store, (s) => s.linkSeries);
  const conjunction = useStore(store, (s) => s.conjunction);
  const constellation = useStore(store, (s) => s.constellation);
  const slewSeries = useStore(store, (s) => s.slewSeries);
  const transfer = useStore(store, (s) => s.transfer);
  const groundTrack = useStore(store, (s) => s.groundTrack);

  return (
    <div className="bessel-analysis" data-testid="analysis-panel">
      {!props.hasSpacecraft ? (
        <p className="bessel-loader-hint" data-testid="analysis-empty-notice">
          Load a spacecraft to analyze. Tools below run on sample data.
        </p>
      ) : null}
      {/* Shared parameters threaded into the span-based and target-based tools. */}
      <div className="bessel-analysis-params" data-testid="analysis-params">
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
      </div>

      {/* Lighting (eclipse umbra) */}
      <Action onClick={() => void engine?.computeEclipse(span)} testId="compute-eclipse">
        Compute eclipse
      </Action>
      <IntervalResult
        intervals={eclipseUmbra}
        span={eclipseSpan}
        title="Umbra intervals"
        label="Eclipse umbra"
        resultTestId="eclipse-result"
        timelineTestId="eclipse-timeline"
        hint="Compute the spacecraft eclipse over the next day."
        csv={{
          testId: 'eclipse-csv',
          filename: 'eclipse-umbra.csv',
          build: (i) => intervalsToCsv(i, { meta: runMeta }),
        }}
      />

      {/* Range time series */}
      <Action onClick={() => void engine?.computeRange(targetSpan)} testId="compute-range">
        Compute range
      </Action>
      <SeriesResult
        series={rangeSeries}
        resultTestId="range-result"
        chartTestId="range-chart"
        hint="Plot the spacecraft range over the next day."
        csv={{
          testId: 'range-csv',
          filename: 'range.csv',
          build: (s) => seriesToCsv(s.et, [s.value], ['range_km'], { meta: runMeta }),
        }}
      />

      {/* Access windows + figure of merit */}
      <Action onClick={() => void engine?.computeAccess(targetSpan)} testId="compute-access">
        Compute access
      </Action>
      <IntervalResult
        intervals={accessWindow}
        span={accessSpan}
        title={`${accessLabel} access`}
        label={`${accessLabel} access`}
        resultTestId="access-result"
        timelineTestId="access-timeline"
        hint="Find the spacecraft line-of-sight access to the Sun."
        csv={{
          testId: 'access-csv',
          filename: 'access.csv',
          build: (i) => intervalsToCsv(i, { meta: runMeta }),
        }}
        extra={
          accessFom ? (
            <p className="bessel-analysis-stat" data-testid="access-fom">
              Coverage {fmt(accessFom.percentCoverage * 100, 1)}%, {accessFom.accessCount} access
              {accessFom.accessCount === 1 ? '' : 'es'}, max gap {fmt(accessFom.maxGapSec / 60, 1)} min
            </p>
          ) : null
        }
      />

      {/* Communications link budget */}
      <Action onClick={() => void engine?.computeLinkBudget(span)} testId="compute-link">
        Compute downlink Eb/N0
      </Action>
      <SeriesResult
        series={linkSeries}
        resultTestId="link-result"
        chartTestId="link-chart"
        hint="Plot the downlink Eb/N0 to a DSN station."
      />

      {/* Conjunction (closest approach + Pc) */}
      <Action
        onClick={() => void engine?.computeConjunction(secondary ? { secondary } : {})}
        testId="compute-conjunction"
      >
        Compute closest approach
      </Action>
      <StatResult
        show={!!conjunction}
        resultTestId="conjunction-result"
        hint="Closest approach and collision probability for the loaded pair."
      >
        {conjunction && (
          <>
            {conjunction.label}: miss {fmt(conjunction.missKm)} km at TCA {fmt(conjunction.tcaSec / 60, 1)} min,
            rel speed {fmt(conjunction.relSpeedKmS, 3)} km/s, Pc {conjunction.pc.toExponential(2)}
          </>
        )}
      </StatResult>

      {/* Constellation design */}
      <Action onClick={() => engine?.computeConstellation()} testId="compute-constellation">
        Design Walker constellation
      </Action>
      <StatResult
        show={!!constellation}
        resultTestId="constellation-result"
        hint="Generate a Walker Delta constellation pattern."
      >
        {constellation && (
          <>
            Walker {constellation.pattern} {constellation.totalSats}/{constellation.planes}/1:
            {' '}{constellation.perPlane} sats x {constellation.planes} planes at {fmt(constellation.altitudeKm, 0)} km,
            {' '}{fmt(constellation.inclinationDeg, 0)} deg
          </>
        )}
      </StatResult>

      {/* Attitude slew profile */}
      <Action onClick={() => void engine?.computeSlew()} testId="compute-slew">
        Compute attitude slew
      </Action>
      <SeriesResult
        series={slewSeries}
        resultTestId="slew-result"
        chartTestId="slew-chart"
        hint="Eigen-axis slew from nadir to Sun pointing."
      />

      {/* Maneuver design (Lambert transfer) */}
      <Action onClick={() => void engine?.computeTransfer()} testId="compute-transfer">
        Solve Lambert transfer
      </Action>
      <StatResult
        show={!!transfer}
        resultTestId="transfer-result"
        hint="Lambert arc departure delta-v over a 2 h transfer."
      >
        {transfer && (
          <>
            {transfer.label}: delta-v {fmt(transfer.deltaVKmS, 4)} km/s over {fmt(transfer.tofHours, 1)} h
          </>
        )}
      </StatResult>

      {/* 2D ground track */}
      <Action onClick={() => void engine?.computeGroundTrack(span)} testId="compute-groundtrack">
        Compute ground track
      </Action>
      {groundTrack ? (
        <div data-testid="groundtrack-result">
          <div className="bessel-panel-title">{groundTrack.label}</div>
          <GroundTrackMap lon={groundTrack.lon} lat={groundTrack.lat} label={groundTrack.label} testId="ground-track" />
        </div>
      ) : (
        <p className="bessel-loader-hint">Project the sub-spacecraft point over the next day.</p>
      )}

      {/* Interop: export CCSDS OEM */}
      <Action variant="secondary" onClick={() => void engine?.exportOem()} testId="export-oem">
        Export CCSDS OEM
      </Action>
    </div>
  );
}
