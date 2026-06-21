// The analysis workbench surfaced in the viewer's Analysis menu. Each tool runs one
// validated core engine (events, access/coverage, rf, conjunction, attitude, mission,
// map-projection, interop) on the loaded spacecraft mission and renders the result
// through the @bessel/ui charting primitives. Presentational: it reads analysis
// slices from the store and calls engine methods; all geometry lives in the engine.
// (STK_PARITY_SPEC F5 / §4.)

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@bessel/selene-design';
import {
  GroundTrackMap,
  IntervalTimeline,
  PanelContainer,
  TimeSeriesChart,
  downloadBlob,
} from '@bessel/ui';
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
    <Button variant={props.variant ?? 'secondary'} full testId={props.testId} onClick={props.onClick}>
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

  // The span-based tools read their span, step, and target from the shared analysis
  // context by default; a per-tool override reveals the local inputs below. The
  // secondary (conjunction) object stays local: it is conjunction-specific, not shared.
  const ctx = useStore(store, (s) => s.analysisContext);
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

  // Run-parameter metadata stamped onto every exported CSV so a result is reproducible.
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const timeSystem = useStore(store, (s) => s.timeSystem);
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
      {/* Span/step/target come from the shared context bar by default; the override
          reveals the local inputs. Secondary (conjunction) is always local. */}
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
          </>
        )}
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

      <PanelContainer title="Geometry" testId="analysis-section-geometry">
        <Action variant="primary" onClick={() => void engine?.computeRange(targetSpan)} testId="compute-range">
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
        <Action onClick={() => void engine?.computeGroundTrack(span)} testId="compute-groundtrack">
          Compute ground track
        </Action>
        {groundTrack ? (
          <div data-testid="groundtrack-result">
            <div className="bessel-panel-title">{groundTrack.label}</div>
            <GroundTrackMap
              lon={groundTrack.lon}
              lat={groundTrack.lat}
              label={groundTrack.label}
              testId="ground-track"
            />
          </div>
        ) : (
          <p className="bessel-loader-hint">Project the sub-spacecraft point over the next day.</p>
        )}
      </PanelContainer>

      <PanelContainer title="Access & Coverage" testId="analysis-section-access">
        <Action variant="primary" onClick={() => void engine?.computeAccess(targetSpan)} testId="compute-access">
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
      </PanelContainer>

      <PanelContainer title="Comms" testId="analysis-section-comms">
        <Action variant="primary" onClick={() => void engine?.computeLinkBudget(span)} testId="compute-link">
          Compute downlink Eb/N0
        </Action>
        <SeriesResult
          series={linkSeries}
          resultTestId="link-result"
          chartTestId="link-chart"
          hint="Plot the downlink Eb/N0 to a DSN station."
        />
      </PanelContainer>

      <PanelContainer title="Conjunction" testId="analysis-section-conjunction">
        <Action
          variant="primary"
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
      </PanelContainer>

      <PanelContainer title="Constellation" testId="analysis-section-constellation">
        <Action variant="primary" onClick={() => engine?.computeConstellation()} testId="compute-constellation">
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
      </PanelContainer>

      <PanelContainer title="Maneuver" testId="analysis-section-maneuver">
        <Action variant="primary" onClick={() => void engine?.computeSlew()} testId="compute-slew">
          Compute attitude slew
        </Action>
        <SeriesResult
          series={slewSeries}
          resultTestId="slew-result"
          chartTestId="slew-chart"
          hint="Eigen-axis slew from nadir to Sun pointing."
        />
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
      </PanelContainer>

      <PanelContainer title="Export" testId="analysis-section-export">
        <Action onClick={() => void engine?.exportOem()} testId="export-oem">
          Export CCSDS OEM
        </Action>
      </PanelContainer>
    </div>
  );
}
