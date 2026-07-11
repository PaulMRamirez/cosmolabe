// The multi-target observation schedule card (analysis-UX Phase 3, observation planner, pulled up
// from P3 per the critique). Takes a target LIST, the active instrument/FOV + the in-FOV pointing
// mode, and the access/keepout constraint stack, then runs the engine op to build a CONFLICT-FREE
// SCHEDULE: an ordered set of non-overlapping observation slots across targets where the attitude
// slew between consecutive targets fits the gap. Renders the ordered timeline + the per-slot table +
// any targets that could not be scheduled (conflicts). Reads the result through the store; the engine
// owns the geometry + the greedy scheduler. Presentational + the engine compute call.

import { createElement } from 'react';
import { IntervalTimeline, downloadBlob } from '@bessel/ui';
import { Button } from '@bessel/selene-design';
import { tableToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import {
  useStore,
  type AppStore,
  type ObservationScheduleResult,
  type RunStatus,
} from '../store/index.ts';
import type { AccessConstraintSpec, ObservationScheduleSpec } from '../engine/analysis-defaults.ts';
import { parseTargetList } from '../engine/ops-access.ts';
import { Action, fmt } from './analysis-shared.tsx';
import { RunStatusNote } from './RunStatus.tsx';

interface ObservationScheduleCardProps {
  engine: BesselEngine | null;
  store: AppStore;
  runStatus: RunStatus | undefined;
  spec: ObservationScheduleSpec;
  setSpec: (v: ObservationScheduleSpec) => void;
  constraints: AccessConstraintSpec;
  /** The raw target-list text (so the comma/space input is preserved as typed). */
  targetText: string;
  setTargetText: (v: string) => void;
  span: { spanSec: number; stepSec: number };
}

/** Format an ET seconds value into a compact relative-minutes label for the schedule rows. */
const minsFrom = (et: number, t0: number): string => `${((et - t0) / 60).toFixed(1)} min`;

/**
 * Serialize a built schedule to CSV: one row per scheduled slot (window start/stop as ET seconds
 * and as minutes from the span start, plus the slew from the previous slot), then one row per
 * unscheduled target with its located reason. Self-contained leaf, mirrors the sibling exports
 * (link worksheet, coverage FOM) that use tableToCsv + downloadBlob.
 */
export function scheduleToCsv(schedule: ObservationScheduleResult): string {
  const t0 = schedule.span[0];
  const rows: (readonly (string | number)[])[] = schedule.slots.map((s) => [
    'scheduled',
    s.targetName,
    s.start,
    s.stop,
    Number(((s.start - t0) / 60).toFixed(3)),
    Number(((s.stop - t0) / 60).toFixed(3)),
    s.slewFromPrevDeg,
    s.slewFromPrevSec,
    '',
  ]);
  for (const u of schedule.unscheduled) {
    rows.push(['unscheduled', u.targetName, '', '', '', '', '', '', u.reason]);
  }
  return tableToCsv(
    [
      'status',
      'target',
      'start_et_s',
      'stop_et_s',
      'start_min',
      'stop_min',
      'slew_deg',
      'slew_s',
      'reason',
    ],
    rows,
  );
}

/**
 * Drop a single target name from the raw target-list text, preserving the order of the remaining
 * targets. Re-serializes through the parsed, de-duplicated list so the per-row remove control and
 * the text input stay in sync (the input is the single source of truth for the target set).
 */
export function removeTargetFromText(raw: string, name: string): string {
  return parseTargetList(raw)
    .filter((t) => t !== name)
    .join(', ');
}

function ObservationScheduleBody(props: ObservationScheduleCardProps): JSX.Element {
  const { engine, store } = props;
  const schedule = useStore(store, (s) => s.observationSchedule);
  const targets = parseTargetList(props.targetText);

  const run = (): void => {
    void engine?.computeObservationSchedule(
      { ...props.spec, targets },
      props.constraints,
      props.span,
    );
  };

  return (
    <>
      <label className="bessel-constraint-band">
        Target list (comma or space separated)
        <input
          type="text"
          value={props.targetText}
          data-testid="param-target-list"
          placeholder="e.g. Titan, Sun"
          onChange={(ev) => props.setTargetText(ev.target.value)}
        />
      </label>
      <label className="bessel-constraint-band">
        Pointing mode
        <select
          value={props.spec.pointing}
          data-testid="param-schedule-pointing"
          onChange={(ev) =>
            props.setSpec({ ...props.spec, pointing: ev.target.value as ObservationScheduleSpec['pointing'] })
          }
        >
          <option value="nadir">Nadir</option>
          <option value="sun">Sun</option>
        </select>
      </label>
      <label className="bessel-constraint-band">
        Min dwell (s)
        <input
          type="number"
          step="any"
          min={0}
          value={props.spec.minDwellSec}
          data-testid="param-schedule-dwell"
          onChange={(ev) => {
            const n = Number(ev.target.value);
            if (Number.isFinite(n)) props.setSpec({ ...props.spec, minDwellSec: n });
          }}
        />
      </label>
      <p className="bessel-loader-hint">
        {targets.length === 0
          ? 'Add one or more observation targets to build a conflict-free schedule.'
          : `${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.join(', ')}.`}
      </p>
      <Action
        variant="primary"
        status={props.runStatus}
        disabled={targets.length === 0}
        onClick={run}
        testId="compute-observation-schedule"
      >
        Build schedule
      </Action>
      <Button
        variant="ghost"
        full
        testId="observation-clear-targets"
        disabled={targets.length === 0}
        onClick={() => props.setTargetText('')}
      >
        Clear targets
      </Button>
      {schedule ? (
        <ScheduleView
          schedule={schedule}
          onRemoveTarget={(name) => props.setTargetText(removeTargetFromText(props.targetText, name))}
        />
      ) : (
        <p className="bessel-loader-hint">
          An ordered, non-overlapping observation timeline across the targets, plus any conflicts.
        </p>
      )}
      <RunStatusNote status={props.runStatus} id="compute-observation-schedule" />
    </>
  );
}

function ScheduleView(props: {
  schedule: ObservationScheduleResult;
  /** Drop a target from the input list (the input is the source of truth for the target set). */
  onRemoveTarget: (name: string) => void;
}): JSX.Element {
  const { schedule, onRemoveTarget } = props;
  const t0 = schedule.span[0];
  const intervals = schedule.slots.map((s) => [s.start, s.stop] as [number, number]);
  const exportCsv = (): void =>
    downloadBlob(new Blob([scheduleToCsv(schedule)], { type: 'text/csv' }), 'observation-schedule.csv');
  return (
    <div data-testid="multi-target-schedule">
      <div className="bessel-panel-title">{schedule.label}</div>
      <p className="bessel-analysis-stat" data-testid="schedule-summary">
        {schedule.slots.length} scheduled, {schedule.unscheduled.length} unscheduled ({schedule.pointing}-pointed).
      </p>
      <IntervalTimeline
        intervals={intervals}
        span={schedule.span}
        label={`${schedule.slots.length} observation slots`}
        testId="schedule-timeline"
      />
      {schedule.slots.length > 0 ? (
        <ol className="bessel-analysis-list" data-testid="schedule-slots">
          {schedule.slots.map((s, i) => (
            <li key={`${s.targetName}-${i}`} data-testid={`schedule-slot-${i}`}>
              {s.targetName}: {minsFrom(s.start, t0)} to {minsFrom(s.stop, t0)}, slew{' '}
              {fmt(s.slewFromPrevDeg, 1)} deg in {fmt(s.slewFromPrevSec, 1)} s
              <Button
                variant="ghost"
                iconOnly
                testId={`schedule-slot-remove-${s.targetName}`}
                ariaLabel={`Remove ${s.targetName}`}
                title={`Remove ${s.targetName}`}
                onClick={() => onRemoveTarget(s.targetName)}
              >
                &times;
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <ul className="bessel-analysis-list" data-testid="schedule-unscheduled">
        {schedule.unscheduled.map((u) => (
          <li key={u.targetName} data-testid={`schedule-unscheduled-${u.targetName}`}>
            {u.targetName}: {u.reason}
            <Button
              variant="ghost"
              iconOnly
              testId={`schedule-unscheduled-remove-${u.targetName}`}
              ariaLabel={`Remove ${u.targetName}`}
              title={`Remove ${u.targetName}`}
              onClick={() => onRemoveTarget(u.targetName)}
            >
              &times;
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="bessel-csv-button" testId="observation-export-csv" onClick={exportCsv}>
        Export schedule CSV
      </Button>
    </div>
  );
}

/** The accordion expects a node; returning a component ELEMENT gives the card its own hooks context. */
export function observationScheduleCard(props: ObservationScheduleCardProps): JSX.Element {
  return createElement(ObservationScheduleBody, props);
}
