// The Phase-2 Access & Comms cards (analysis-UX Phase 2, comms-engineer + observation-planner
// journeys): the az/el-masked Station Passes timeline (selectable rows with a per-row Bind toggle
// and a per-row "Pair with next" toggle that drive the active-selection bindings), the itemized
// Link-Budget Worksheet over the selected
// pass (worst-case + nominal tables + a margin-vs-time chart with the threshold drawn + CSV), and
// the Slew Feasibility card (does the eigen-axis slew between two selected passes fit the gap). All
// read the active station + the active-selection through the store; the engine owns the geometry.

import { createElement } from 'react';
import { Button } from '@bessel/selene-design';
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
import { Action, Keep, fmt, useTrayFull } from './analysis-shared.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { RAD2DEG } from '../angles.ts';

/** Format an ET seconds value into a compact relative-minutes label for the pass rows. */
const minsFrom = (et: number, t0: number): string => `${((et - t0) / 60).toFixed(1)} min`;

/** A small clearable binding chip (F33): a label of what is bound + a ✕ that clears it via the
 *  passed handler (an existing engine setter). Rendered next to the not-ready hints so the bound
 *  pass/pair is both visible and dismissible without scrolling back to the passes card. */
function BindingChip(props: { label: string; testId: string; onClear: () => void }): JSX.Element {
  return (
    <span className="bessel-binding-chip" data-testid={props.testId}>
      {props.label}
      <button
        type="button"
        className="bessel-binding-chip-clear"
        aria-label="Clear binding"
        data-testid={`${props.testId}-clear`}
        onClick={props.onClear}
      >
        ✕
      </button>
    </span>
  );
}

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
  const trayFull = useTrayFull(store);

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
      <Keep
        domain="access-passes"
        disabled={!passes || trayFull}
        onKeep={() => engine?.keepSnapshot('access-passes')}
      />
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
  // The slew pair lives on the rows now (F40): "Pair with next" pairs a row with the chronologically
  // next pass; a row is "Paired" when it is the pair's first member. Reuses the slew-pair binding the
  // old <select> wrote, so the slew card's feasibility behavior is unchanged.
  const pairFromId = props.selectedPair?.[0] ?? null;
  const togglePair = (fromId: string, nextId: string | undefined): void => {
    if (pairFromId === fromId) {
      engine?.setSelectedWindowPair(null);
      return;
    }
    engine?.setSelectedWindowPair(nextId ? [fromId, nextId] : null);
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
            <th>Pair</th>
            <th>Rise</th>
            <th>Set</th>
            <th>Max el (deg)</th>
            <th>Range (km)</th>
          </tr>
        </thead>
        <tbody>
          {passes.passes.map((p, i) => {
            const nextId = passes.passes[i + 1]?.id;
            const isLast = i === passes.passes.length - 1;
            const isPaired = pairFromId === p.id;
            return (
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
                <td>
                  {/* A pair is two CONSECUTIVE passes, so the last row has no "next" to pair with. */}
                  <button
                    type="button"
                    data-testid={`slew-pair-${i}`}
                    aria-pressed={isPaired}
                    disabled={isLast}
                    onClick={() => togglePair(p.id, nextId)}
                  >
                    {isPaired ? 'Paired' : 'Pair with next'}
                  </button>
                </td>
                <td>{minsFrom(p.rise, t0)}</td>
                <td>{minsFrom(p.set, t0)}</td>
                <td>{fmt(p.maxElevationRad * RAD2DEG, 1)}</td>
                <td>{fmt(p.maxElevationRangeKm, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const trayFull = useTrayFull(store);

  return (
    <>
      <LinkWorksheetForm value={props.worksheetParams} onChange={props.setWorksheetParams} />
      <p className="bessel-loader-hint" data-testid="link-worksheet-binding">
        {selectedPassId ? (
          <>
            Bound to{' '}
            <BindingChip
              label={`pass ${selectedPassId}`}
              testId="link-worksheet-binding-chip"
              onClear={() => engine?.setSelectedPass(null)}
            />{' '}
            (worst-case + nominal elevation).
          </>
        ) : (
          'No pass selected: a representative geometry is used (select a pass row above to bind).'
        )}
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
      <Keep
        domain="access-worksheet"
        disabled={!worksheet || trayFull}
        onKeep={() => engine?.keepSnapshot('access-worksheet')}
      />
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
      <Button
        variant="secondary"
        className="bessel-csv-button"
        testId="link-worksheet-csv"
        onClick={() => {
          exportCase('worst', worksheet.worstCase.lines);
          exportCase('nominal', worksheet.nominal.lines);
        }}
      >
        Export worksheet CSV
      </Button>
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
  const trayFull = useTrayFull(store);

  return (
    <>
      <SlewFeasibilityForm value={props.slewParams} onChange={props.setSlewParams} />
      <p className="bessel-loader-hint" data-testid="slew-feasibility-binding">
        {selectedPair ? (
          <>
            Bound to{' '}
            <BindingChip
              label={`consecutive passes ${selectedPair[0]} and ${selectedPair[1]}`}
              testId="slew-feasibility-binding-chip"
              onClear={() => engine?.setSelectedWindowPair(null)}
            />
            .
          </>
        ) : (
          'Pair two consecutive passes (the "Pair with next" toggle on the passes card) to enable this check.'
        )}
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
      <Keep
        domain="access-slew"
        disabled={!verdict || trayFull}
        onKeep={() => engine?.keepSnapshot('access-slew')}
      />
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
