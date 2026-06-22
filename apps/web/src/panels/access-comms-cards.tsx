// The Phase-2 Access & Comms cards (analysis-UX Phase 2, comms-engineer + observation-planner
// journeys): the az/el-masked Station Passes timeline (selectable rows + a consecutive-pair select
// that drive the active-selection bindings), the itemized Link-Budget Worksheet over the selected
// pass (worst-case + nominal tables + a margin-vs-time chart with the threshold drawn + CSV), and
// the Slew Feasibility card (does the eigen-axis slew between two selected passes fit the gap). All
// read the active station + the active-selection through the store; the engine owns the geometry.

import { createElement } from 'react';
import { TimeSeriesChart, downloadBlob } from '@bessel/ui';
import { tableToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import {
  useStore,
  type AppStore,
  type LinkWorksheetCase,
  type LinkWorksheetResult,
  type RunStatus,
  type StationPassesResult,
  type SlewFeasibilityResult,
} from '../store/index.ts';
import { LinkWorksheetForm, SlewFeasibilityForm } from './analysis-tool-forms.tsx';
import type { LinkWorksheetSpec, SlewFeasibilitySpec } from '../engine/analysis-defaults.ts';
import { Action, fmt } from './analysis-shared.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { RAD2DEG } from '../angles.ts';

/** Format an ET seconds value into a compact relative-minutes label for the pass rows. */
const minsFrom = (et: number, t0: number): string => `${((et - t0) / 60).toFixed(1)} min`;

// -- Station Passes ----------------------------------------------------------------------------

interface StationPassesCardProps {
  engine: BesselEngine | null;
  store: AppStore;
  runStatus: RunStatus | undefined;
  span: { spanSec: number; stepSec: number };
}

/** The card body is a component (it calls useStore) so the accordion can mount/unmount it without
 *  breaking the rules of hooks; the exported `stationPassesCard` returns the element. */
function StationPassesBody(props: StationPassesCardProps): JSX.Element {
  const { engine, store } = props;
  const passes = useStore(store, (s) => s.stationPasses);
  const activeStationId = useStore(store, (s) => s.scenario.activeStationId);
  const selectedPassId = useStore(store, (s) => s.selectedPassId);
  const selectedPair = useStore(store, (s) => s.selectedWindowPair);

  return (
    <>
      {activeStationId ? null : (
        <p className="bessel-loader-hint" data-testid="station-passes-gate">
          Add and select a ground station in the context bar to compute passes.
        </p>
      )}
      <Action
        variant="primary"
        status={props.runStatus}
        disabled={!activeStationId}
        onClick={() => void engine?.computeStationPasses(props.span)}
        testId="compute-station-passes"
      >
        Compute station passes
      </Action>
      {passes ? <StationPassTable passes={passes} engine={engine} selectedPassId={selectedPassId} selectedPair={selectedPair} /> : (
        <p className="bessel-loader-hint">
          Rise/set passes over the active station (az/el mask), with max-elevation per pass. Select a
          pass to bind the worksheet; pick a pair for the slew check.
        </p>
      )}
      <RunStatusNote status={props.runStatus} id="compute-station-passes" />
    </>
  );
}

function StationPassTable(props: {
  passes: StationPassesResult;
  engine: BesselEngine | null;
  selectedPassId: string | null;
  selectedPair: readonly [string, string] | null;
}): JSX.Element {
  const { passes, engine } = props;
  const t0 = passes.span[0];
  // The pair select: choosing a "from" pass pairs it with the chronologically next pass for the slew.
  const pairFrom = props.selectedPair?.[0] ?? '';
  const selectPair = (fromId: string): void => {
    if (!fromId) {
      engine?.setSelectedWindowPair(null);
      return;
    }
    const idx = passes.passes.findIndex((p) => p.id === fromId);
    const next = passes.passes[idx + 1];
    engine?.setSelectedWindowPair(next ? [fromId, next.id] : null);
  };
  return (
    <div data-testid="station-passes">
      <div className="bessel-panel-title">{passes.label}</div>
      <p className="bessel-analysis-stat" data-testid="station-passes-fom">
        {passes.passes.length} pass{passes.passes.length === 1 ? '' : 'es'}, coverage{' '}
        {fmt(passes.fom.percentCoverage * 100, 1)}%, max gap {fmt(passes.fom.maxGapSec / 60, 1)} min.
      </p>
      <table className="bessel-analysis-table" data-testid="station-passes-table">
        <thead>
          <tr>
            <th>Bind</th>
            <th>Rise</th>
            <th>Set</th>
            <th>Max el (deg)</th>
            <th>Range (km)</th>
          </tr>
        </thead>
        <tbody>
          {passes.passes.map((p) => (
            <tr
              key={p.id}
              data-testid={`station-pass-${p.id}`}
              aria-selected={props.selectedPassId === p.id}
              className={props.selectedPassId === p.id ? 'bessel-row-selected' : undefined}
            >
              <td>
                <button
                  type="button"
                  data-testid={`select-pass-${p.id}`}
                  aria-pressed={props.selectedPassId === p.id}
                  onClick={() => engine?.setSelectedPass(props.selectedPassId === p.id ? null : p.id)}
                >
                  {props.selectedPassId === p.id ? 'Bound' : 'Bind'}
                </button>
              </td>
              <td>{minsFrom(p.rise, t0)}</td>
              <td>{minsFrom(p.set, t0)}</td>
              <td>{fmt(p.maxElevationRad * RAD2DEG, 1)}</td>
              <td>{fmt(p.maxElevationRangeKm, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {passes.passes.length >= 2 ? (
        <label className="bessel-constraint-band">
          Slew pair (from pass)
          <select
            value={pairFrom}
            data-testid="select-pass-pair"
            onChange={(ev) => selectPair(ev.target.value)}
          >
            <option value="">(none)</option>
            {passes.passes.slice(0, -1).map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} to next
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

// -- Link-budget worksheet ---------------------------------------------------------------------

interface LinkWorksheetCardProps {
  engine: BesselEngine | null;
  store: AppStore;
  runStatus: RunStatus | undefined;
  worksheetParams: LinkWorksheetSpec;
  setWorksheetParams: (v: LinkWorksheetSpec) => void;
}

function LinkWorksheetBody(props: LinkWorksheetCardProps): JSX.Element {
  const { engine, store } = props;
  const worksheet = useStore(store, (s) => s.linkWorksheet);
  const selectedPassId = useStore(store, (s) => s.selectedPassId);

  return (
    <>
      <LinkWorksheetForm value={props.worksheetParams} onChange={props.setWorksheetParams} />
      <p className="bessel-loader-hint" data-testid="link-worksheet-binding">
        {selectedPassId
          ? `Bound to selected pass ${selectedPassId} (worst-case + nominal elevation).`
          : 'No pass selected: a representative geometry is used (select a pass row above to bind).'}
      </p>
      <Action
        variant="primary"
        status={props.runStatus}
        onClick={() => void engine?.computeLinkWorksheet(props.worksheetParams)}
        testId="compute-link-worksheet"
      >
        Assemble link worksheet
      </Action>
      {worksheet ? <LinkWorksheetView worksheet={worksheet} /> : (
        <p className="bessel-loader-hint">
          The itemized line-by-line link budget at the worst-case and nominal elevation of the selected
          pass, with a margin-vs-time chart.
        </p>
      )}
      <RunStatusNote status={props.runStatus} id="compute-link-worksheet" />
    </>
  );
}

function WorksheetTable(props: { case: LinkWorksheetCase; testId: string }): JSX.Element {
  return (
    <table className="bessel-analysis-table" data-testid={props.testId}>
      <caption>
        {props.case.caseLabel}: {fmt(props.case.elevationDeg, 1)} deg, {fmt(props.case.rangeKm, 0)} km
      </caption>
      <tbody>
        {props.case.lines.map((l) => (
          <tr key={l.id} data-testid={`${props.testId}-${l.id}`}>
            <td>{l.label}</td>
            <td>{fmt(l.value, 2)}</td>
            <td>{l.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinkWorksheetView(props: { worksheet: LinkWorksheetResult }): JSX.Element {
  const { worksheet } = props;
  const exportCase = (caseLabel: string, lines: readonly { label: string; value: number; unit: string }[]): void => {
    // The MODCOD + pass binding are stamped as the first data rows so the file is self-describing.
    const rows = [
      ['MODCOD', worksheet.modcodName, ''] as const,
      ['pass', worksheet.passId ?? 'representative', ''] as const,
      ...lines.map((l) => [l.label, l.value, l.unit] as const),
    ];
    const csv = tableToCsv(['line item', 'value', 'unit'], rows);
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `link-worksheet-${caseLabel}.csv`);
  };
  return (
    <div data-testid="link-worksheet">
      <div className="bessel-panel-title">{worksheet.label}</div>
      {worksheet.note ? (
        <p className="bessel-loader-hint" data-testid="link-worksheet-note">
          {worksheet.note}
        </p>
      ) : null}
      <p className="bessel-analysis-stat" data-testid="link-margin">
        Margin: worst-case {fmt(worksheet.worstCase.marginDb, 1)} dB, nominal{' '}
        {fmt(worksheet.nominal.marginDb, 1)} dB (MODCOD {worksheet.modcodName}, required{' '}
        {fmt(worksheet.requiredEbN0Db, 1)} dB Eb/N0).
      </p>
      <WorksheetTable case={worksheet.worstCase} testId="link-worksheet-worst" />
      <WorksheetTable case={worksheet.nominal} testId="link-worksheet-nominal" />
      <TimeSeriesChart
        et={worksheet.marginSeries.et}
        value={worksheet.marginSeries.value}
        label="Link margin over the pass (dB)"
        threshold={0}
        testId="link-margin-chart"
      />
      <p className="bessel-loader-hint">
        The dashed line is the link-closes threshold (margin = 0).
      </p>
      <button
        type="button"
        className="bessel-csv-button"
        data-testid="link-worksheet-csv"
        onClick={() => {
          exportCase('worst', worksheet.worstCase.lines);
          exportCase('nominal', worksheet.nominal.lines);
        }}
      >
        Export worksheet CSV
      </button>
    </div>
  );
}

// -- Slew feasibility --------------------------------------------------------------------------

interface SlewFeasibilityCardProps {
  engine: BesselEngine | null;
  store: AppStore;
  runStatus: RunStatus | undefined;
  slewParams: SlewFeasibilitySpec;
  setSlewParams: (v: SlewFeasibilitySpec) => void;
}

function SlewFeasibilityBody(props: SlewFeasibilityCardProps): JSX.Element {
  const { engine, store } = props;
  const verdict = useStore(store, (s) => s.slewFeasibility);
  const selectedPair = useStore(store, (s) => s.selectedWindowPair);

  return (
    <>
      <SlewFeasibilityForm value={props.slewParams} onChange={props.setSlewParams} />
      <p className="bessel-loader-hint" data-testid="slew-feasibility-binding">
        {selectedPair
          ? `Bound to consecutive passes ${selectedPair[0]} and ${selectedPair[1]}.`
          : 'Select two consecutive passes (the slew-pair select on the passes card) to enable this check.'}
      </p>
      <Action
        variant="primary"
        status={props.runStatus}
        disabled={!selectedPair}
        onClick={() => void engine?.computeSlewFeasibility(props.slewParams)}
        testId="compute-slew-feasibility"
      >
        Check slew feasibility
      </Action>
      {verdict ? <SlewVerdict verdict={verdict} /> : (
        <p className="bessel-loader-hint">
          Compares the eigen-axis slew duration between two consecutive windows against the gap, in
          target-track or inertial mode.
        </p>
      )}
      <RunStatusNote status={props.runStatus} id="compute-slew-feasibility" />
    </>
  );
}

function SlewVerdict(props: { verdict: SlewFeasibilityResult }): JSX.Element {
  const { verdict } = props;
  return (
    <div data-testid="slew-feasibility">
      <div className="bessel-panel-title">{verdict.label}</div>
      <p className="bessel-analysis-stat" data-testid="slew-fits" data-fits={verdict.fits}>
        {verdict.fits ? 'Slew FITS' : 'Slew does NOT fit'}: {fmt(verdict.slewAngleDeg, 1)} deg slew in{' '}
        {fmt(verdict.slewDurationSec, 1)} s vs a {fmt(verdict.gapSec, 1)} s gap (slack{' '}
        {fmt(verdict.slackSec, 1)} s, {verdict.mode} mode).
      </p>
    </div>
  );
}

// -- Card renderers (element factories) --------------------------------------------------------
// The accordion's `render: () => ...` expects a node; returning a component ELEMENT (not invoking
// the body as a function) gives each card its own hooks context, so mounting/unmounting cards as
// they expand/collapse does not break the rules of hooks.

export function stationPassesCard(props: StationPassesCardProps): JSX.Element {
  return createElement(StationPassesBody, props);
}

export function linkWorksheetCard(props: LinkWorksheetCardProps): JSX.Element {
  return createElement(LinkWorksheetBody, props);
}

export function slewFeasibilityCard(props: SlewFeasibilityCardProps): JSX.Element {
  return createElement(SlewFeasibilityBody, props);
}
