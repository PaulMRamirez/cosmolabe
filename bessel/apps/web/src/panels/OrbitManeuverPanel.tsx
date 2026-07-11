// The Orbit & Maneuver domain tab (analysis-UX re-slot, design section 3, tab 1; OD folded
// in per decision 7.1): TLE/state propagation, the Mission Control Sequence builder, the
// orbit-determination workbench, and the maneuver tools (attitude slew, Lambert transfer),
// surfaced as collapsible TaskCards. The propagation/mission/OD bodies are the existing
// panels mounted unchanged; the slew card is moved verbatim from the former AnalysisPanel
// Maneuver section. The Lambert card is the Phase-2 configurable transfer + porkchop sweep with a
// send-to-MCS hop (LambertPorkchopCard). Presentational; the geometry runs behind the lazy seam.

import { useState, type ReactNode } from 'react';
import { DomainIcon } from '@bessel/selene-design';
import { seriesToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { PropagatePanel } from './PropagatePanel.tsx';
import { MissionPanel } from './MissionPanel.tsx';
import { OdPanel } from './OdPanel.tsx';
import { SeriesResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import { SlewParamsForm, DEFAULT_SLEW_PARAMS, type SlewFormParams } from './analysis-tool-forms.tsx';
import { Action, useAnalysisParams } from './analysis-shared.tsx';
import { LambertPorkchopCard } from './LambertPorkchopCard.tsx';

export interface OrbitManeuverPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly expandRequest?: ExpandRequest;
}

export function OrbitManeuverPanel(props: OrbitManeuverPanelProps): JSX.Element {
  const { engine, store } = props;
  // The maneuver cards reuse the shared run-metadata for a reproducible slew CSV.
  const params = useAnalysisParams(store, { withTarget: false, withSecondary: false });
  const { runMeta, scalarCsv } = params;

  const [slew, setSlew] = useState<SlewFormParams>(DEFAULT_SLEW_PARAMS);

  const runStatus = useStore(store, (s) => s.runStatus);
  const slewSeries = useStore(store, (s) => s.slewSeries);

  const slewCard = (): ReactNode => (
    <>
      <SlewParamsForm value={slew} onChange={setSlew} />
      <Action
        variant="primary"
        status={runStatus['compute-slew']}
        onClick={() =>
          void engine?.computeSlew({
            fromMode: slew.fromMode,
            toMode: slew.toMode,
            maxRateDeg: slew.maxRateDeg,
            maxAccelDeg: slew.maxAccelDeg,
          })
        }
        testId="compute-slew"
      >
        Compute attitude slew
      </Action>
      <SeriesResult
        series={slewSeries}
        resultTestId="slew-result"
        chartTestId="slew-chart"
        hint="Eigen-axis slew between two pointing references."
        csv={{
          testId: 'slew-csv',
          filename: 'slew.csv',
          build: (s) => seriesToCsv(s.et, [s.value], ['slew_deg'], { epochHeader: 't_s', meta: runMeta }),
        }}
      />
      <RunStatusNote status={runStatus['compute-slew']} id="compute-slew" />
    </>
  );

  const lambertCard = (): ReactNode => (
    <LambertPorkchopCard engine={engine} store={store} scalarCsv={scalarCsv} />
  );

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'propagate',
      icon: <DomainIcon name="propagate" size="sm" />,
      title: 'Propagate orbit (SGP4 / HPOP)',
      purpose: 'Propagate a TLE/state and read altitude + ground track.',
      status: runStatus['propagate-tle'],
      render: () => <PropagatePanel engine={engine} store={store} />,
    },
    {
      id: 'mcs',
      title: 'Mission control sequence',
      purpose: 'Build and run an MCS with a differential corrector.',
      status: runStatus['run-mcs'],
      render: () => <MissionPanel engine={engine} store={store} />,
    },
    {
      id: 'od',
      title: 'Orbit determination',
      purpose: 'Batch least-squares fit with residuals and covariance.',
      status: runStatus['run-od'],
      render: () => <OdPanel engine={engine} store={store} />,
    },
    {
      id: 'slew',
      title: 'Attitude slew',
      purpose: 'Eigen-axis slew profile between two pointing modes.',
      status: runStatus['compute-slew'],
      render: slewCard,
    },
    {
      id: 'lambert',
      icon: <DomainIcon name="porkchop" size="sm" />,
      title: 'Lambert transfer + porkchop',
      purpose: 'Sweep a departure x time-of-flight delta-v contour, then send the best to MCS.',
      status: runStatus['compute-porkchop'],
      render: lambertCard,
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="orbit-maneuver-panel">
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['propagate', 'mcs']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
