// The Report & Compare domain tab (analysis-UX re-slot, design section 3, tab 6): the
// cross-cutting sinks. It composes the data-provider report workbench, the CCSDS OEM
// export, the kept-snapshot compare tray, and the predicted-versus-actual telemetry
// overlay, surfaced as collapsible TaskCards. The bodies are the existing panels mounted
// unchanged; the OEM export JSX is moved verbatim from the former AnalysisPanel Export
// section. Presentational; no engine capability changes here.

import { type ReactNode } from 'react';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import type { PredictedVsActual } from '@bessel/state';
import { TelemetryOverlay } from '@bessel/ui';
import { ReportPanel } from './ReportPanel.tsx';
import { CompareTray } from './CompareTray.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import { Action } from './analysis-shared.tsx';

export interface ReportComparePanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly telemetryOverlay: readonly PredictedVsActual[];
  readonly et: number;
  readonly telemetryFault: string | null;
  readonly expandRequest?: ExpandRequest;
}

export function ReportComparePanel(props: ReportComparePanelProps): JSX.Element {
  const { engine, store } = props;
  const runStatus = useStore(store, (s) => s.runStatus);

  const reportCard = (): ReactNode => <ReportPanel engine={engine} store={store} />;

  const exportCard = (): ReactNode => (
    <>
      <Action status={runStatus['export-oem']} onClick={() => void engine?.exportOem()} testId="export-oem">
        Export CCSDS OEM
      </Action>
      <RunStatusNote status={runStatus['export-oem']} id="export-oem" />
    </>
  );

  const compareCard = (): ReactNode => (
    <>
      <CompareTray engine={engine} store={store} />
      {!props.hasSpacecraft ? (
        <p className="bessel-loader-hint" data-testid="telemetry-empty-notice">
          Load a spacecraft to analyze.
        </p>
      ) : null}
      <TelemetryOverlay series={props.telemetryOverlay} nowEt={props.et} fault={props.telemetryFault} />
    </>
  );

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'report',
      title: 'Data-provider report',
      purpose: 'Run a provider over an observer/target pair and grid.',
      status: runStatus['run-report'],
      render: reportCard,
    },
    {
      id: 'export-oem',
      title: 'Export trajectory (OEM)',
      purpose: 'Download the spacecraft trajectory as a CCSDS OEM.',
      status: runStatus['export-oem'],
      render: exportCard,
    },
    {
      id: 'compare',
      title: 'Compare kept results',
      purpose: 'Tabulate kept snapshots and the telemetry overlay.',
      render: compareCard,
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="report-compare-panel">
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['report', 'compare']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
