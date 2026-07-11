// The Access & Comms domain tab (analysis-UX, design section 3, tab 3): the access tools (the
// composable constraint-stack access run, the selectable-pointing in-FOV observation windows)
// plus the comms link tools, surfaced as collapsible TaskCards. Phase 2 deepens ACCESS & COMMS:
// the az/el-mask access constraint is UNGATED against the registered ground station; a Station
// Passes card computes rise/set passes over the ACTIVE station (selectable rows + a consecutive
// pair); a Link-Budget WORKSHEET assembles the itemized budget over the SELECTED pass with a
// margin-vs-time chart and CSV; and a Slew Feasibility card checks whether the eigen-axis slew
// between two selected passes fits the gap. Presentational + the engine compute calls.

import { useState, type ReactNode } from 'react';
import { seriesToCsv, intervalsToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import {
  DEFAULT_ACCESS_CONSTRAINTS,
  DEFAULT_LINK_WORKSHEET,
  DEFAULT_SLEW_FEASIBILITY,
  DEFAULT_OBSERVATION_SCHEDULE,
  type AccessConstraintSpec,
  type FovPointingMode,
  type LinkWorksheetSpec,
  type SlewFeasibilitySpec,
  type ObservationScheduleSpec,
} from '../engine/analysis-defaults.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { IntervalResult, SeriesResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import { LinkParamsForm, DEFAULT_LINK_PARAMS, type LinkParams } from './analysis-tool-forms.tsx';
import { AccessConstraintForm } from './AccessConstraintForm.tsx';
import { stationPassesCard, linkWorksheetCard, slewFeasibilityCard } from './access-comms-cards.tsx';
import { observationScheduleCard } from './observation-schedule-card.tsx';
import {
  Action,
  EmptyNotice,
  FomNote,
  Keep,
  fmt,
  linkParamsPreamble,
  useAnalysisParams,
  useTrayFull,
} from './analysis-shared.tsx';

export interface AccessCommsPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly expandRequest?: ExpandRequest;
}

const POINTING_OPTIONS: readonly { readonly value: FovPointingMode; readonly label: string }[] = [
  { value: 'nadir', label: 'Nadir' },
  { value: 'sun', label: 'Sun' },
];

export function AccessCommsPanel(props: AccessCommsPanelProps): JSX.Element {
  const { engine, store } = props;
  const params = useAnalysisParams(store, { withTarget: true, withSecondary: false });
  const { span, targetSpan, runMeta } = params;
  const trayFull = useTrayFull(store);

  const [link, setLink] = useState<LinkParams>(DEFAULT_LINK_PARAMS);
  const [constraints, setConstraints] = useState<AccessConstraintSpec>(DEFAULT_ACCESS_CONSTRAINTS);
  const [pointing, setPointing] = useState<FovPointingMode>('nadir');
  const [worksheetParams, setWorksheetParams] = useState<LinkWorksheetSpec>(DEFAULT_LINK_WORKSHEET);
  const [slewParams, setSlewParams] = useState<SlewFeasibilitySpec>(DEFAULT_SLEW_FEASIBILITY);
  // [ux-p3-access] The multi-target schedule spec + its raw target-list text (kept as typed).
  const [scheduleSpec, setScheduleSpec] = useState<ObservationScheduleSpec>(DEFAULT_OBSERVATION_SCHEDULE);
  const [scheduleTargets, setScheduleTargets] = useState<string>('');

  const runStatus = useStore(store, (s) => s.runStatus);
  const accessResult = useStore(store, (s) => s.accessResult);
  const accessBreakdown = useStore(store, (s) => s.accessBreakdown);
  const fovResult = useStore(store, (s) => s.fovResult);
  const fovSurviving = useStore(store, (s) => s.fovSurviving);
  const fovOk = useStore(store, (s) => s.fovOk);
  const linkSeries = useStore(store, (s) => s.linkSeries);
  const linkParams = useStore(store, (s) => s.linkParams);
  // [ux-p2-access] The active ground station's name (role slot) drives the az/el-mask ungate.
  const activeStationName = useStore(store, (s) => {
    const id = s.scenario.activeStationId;
    return id ? (s.scenario.stations.find((st) => st.id === id)?.name ?? null) : null;
  });

  const accessCard = (): ReactNode => (
    <>
      <AccessConstraintForm value={constraints} onChange={setConstraints} activeStationName={activeStationName} />
      <Action
        variant="primary"
        status={runStatus['compute-access']}
        onClick={() => void engine?.computeAccessStack(constraints, targetSpan)}
        testId="compute-access"
      >
        Compute access
      </Action>
      <IntervalResult
        intervals={accessResult?.window ?? null}
        span={accessResult?.span ?? null}
        title={`${accessResult?.label ?? ''} access`}
        label={`${accessResult?.label ?? ''} access`}
        resultTestId="access-result"
        timelineTestId="access-timeline"
        hint="Assemble a constraint stack and find the surviving spacecraft-to-target access window."
        csv={{
          testId: 'access-csv',
          filename: 'access.csv',
          build: (i) => intervalsToCsv(i, { meta: runMeta }),
        }}
        extra={
          <>
            <FomNote fom={accessResult?.fom} verb="Coverage" noun="access" plural="es" testId="access-fom" />
            {accessBreakdown && accessBreakdown.length > 0 ? (
              <ul className="bessel-analysis-list" data-testid="access-breakdown">
                {accessBreakdown.map((b) => (
                  <li key={b.label} data-testid="access-breakdown-item">
                    {b.label}: alone admits {fmt(b.fom.percentCoverage * 100, 1)}% of the span.
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        }
      />
      <RunStatusNote status={runStatus['compute-access']} id="compute-access" />
      <Keep domain="access" disabled={!accessResult || trayFull} onKeep={() => engine?.keepSnapshot('access')} />
    </>
  );

  const fovCard = (): ReactNode => (
    <>
      <label className="bessel-constraint-band">
        Pointing mode
        <select
          value={pointing}
          data-testid="param-fov-pointing"
          onChange={(ev) => setPointing(ev.target.value as FovPointingMode)}
        >
          {POINTING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="bessel-loader-hint" data-testid="fov-pointing-hint">
        Target-tracking pointing needs real attitude (CK) wiring, Phase 2.
      </p>
      <Action
        variant="primary"
        status={runStatus['compute-fov']}
        disabled={!fovOk}
        onClick={() => void engine?.computeFovWindows(pointing, constraints, targetSpan)}
        testId="compute-fov"
      >
        Compute in-FOV
      </Action>
      <IntervalResult
        intervals={fovResult?.window ?? null}
        span={fovResult?.span ?? null}
        title={`${fovResult?.label || 'Instrument'} in-FOV`}
        label={`${fovResult?.label || 'Instrument'} in-FOV`}
        resultTestId="fov-result"
        timelineTestId="fov-timeline"
        hint="Find when the target falls within the active sensor's FOV for the selected pointing mode."
        csv={{
          testId: 'fov-csv',
          filename: 'in-fov.csv',
          build: (i) => intervalsToCsv(i, { meta: runMeta }),
        }}
        extra={<FomNote fom={fovResult?.fom} verb="In view" noun="window" plural="s" testId="fov-fom" />}
      />
      <IntervalResult
        intervals={fovSurviving?.window ?? null}
        span={fovSurviving?.span ?? null}
        title={`${fovSurviving?.label || 'Instrument'} post-constraint`}
        label={`${fovSurviving?.label || 'Instrument'} post-constraint`}
        resultTestId="fov-surviving-result"
        timelineTestId="fov-surviving-timeline"
        hint="The in-FOV window after intersecting with the assembled access constraint stack."
        csv={{
          testId: 'fov-surviving-csv',
          filename: 'in-fov-surviving.csv',
          build: (i) => intervalsToCsv(i, { meta: runMeta }),
        }}
        extra={<FomNote fom={fovSurviving?.fom} verb="Surviving" noun="window" plural="s" testId="fov-surviving-fom" />}
      />
      <RunStatusNote status={runStatus['compute-fov']} id="compute-fov" />
    </>
  );

  const linkCard = (): ReactNode => (
    <>
      <LinkParamsForm value={link} onChange={setLink} />
      <Action
        variant="primary"
        status={runStatus['compute-link']}
        onClick={() =>
          void engine?.computeLinkBudget({
            ...span,
            eirpDbW: link.eirpDbW,
            freqHz: link.freqGHz * 1e9,
            gOverTDbK: link.gOverTDbK,
            dataRateBps: link.dataRateBps,
          })
        }
        testId="compute-link"
      >
        Compute downlink Eb/N0
      </Action>
      <SeriesResult
        series={linkSeries}
        resultTestId="link-result"
        chartTestId="link-chart"
        hint="Plot the downlink Eb/N0 to a ground station."
        csv={{
          testId: 'link-csv',
          filename: 'link-ebn0.csv',
          build: (s) =>
            linkParamsPreamble(linkParams) + seriesToCsv(s.et, [s.value], ['ebN0_dB'], { meta: runMeta }),
        }}
      />
      <RunStatusNote status={runStatus['compute-link']} id="compute-link" />
      <Keep domain="link" disabled={!linkSeries || trayFull} onKeep={() => engine?.keepSnapshot('link')} />
    </>
  );

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'access',
      title: 'Constraint-stack access',
      purpose: 'Surviving visibility windows under a composable constraint stack.',
      status: runStatus['compute-access'],
      render: accessCard,
    },
    {
      id: 'in-fov',
      title: 'In-FOV observation windows',
      purpose: 'When a target falls within the active sensor FOV, by pointing mode.',
      status: runStatus['compute-fov'],
      render: fovCard,
    },
    {
      id: 'link',
      title: 'Downlink budget',
      purpose: 'Eb/N0 over the pass for a configured radio link.',
      status: runStatus['compute-link'],
      render: linkCard,
    },
    {
      id: 'station-passes',
      title: 'Station passes',
      purpose: 'Rise/set passes over the active station (az/el mask), selectable for the worksheet.',
      status: runStatus['compute-station-passes'],
      render: () =>
        stationPassesCard({ engine, store, runStatus: runStatus['compute-station-passes'], span }),
    },
    {
      id: 'link-worksheet',
      title: 'Link-budget worksheet',
      purpose: 'Itemized line-by-line budget + margin-vs-time over the selected pass.',
      status: runStatus['compute-link-worksheet'],
      render: () =>
        linkWorksheetCard({
          engine,
          store,
          runStatus: runStatus['compute-link-worksheet'],
          worksheetParams,
          setWorksheetParams,
        }),
    },
    {
      id: 'slew-feasibility',
      title: 'Slew feasibility',
      purpose: 'Does the eigen-axis slew between two selected passes fit in the gap?',
      status: runStatus['compute-slew-feasibility'],
      render: () =>
        slewFeasibilityCard({
          engine,
          store,
          runStatus: runStatus['compute-slew-feasibility'],
          slewParams,
          setSlewParams,
        }),
    },
    {
      id: 'observation-schedule',
      title: 'Observation multi-target schedule',
      purpose: 'A conflict-free, slew-feasible observation timeline across a target list.',
      status: runStatus['compute-observation-schedule'],
      render: () =>
        observationScheduleCard({
          engine,
          store,
          runStatus: runStatus['compute-observation-schedule'],
          spec: scheduleSpec,
          setSpec: setScheduleSpec,
          constraints,
          targetText: scheduleTargets,
          setTargetText: setScheduleTargets,
          span: { spanSec: targetSpan.spanSec, stepSec: targetSpan.stepSec },
        }),
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="access-comms-panel">
      <EmptyNotice hasSpacecraft={props.hasSpacecraft} />
      {params.paramsBar}
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['access', 'link']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
