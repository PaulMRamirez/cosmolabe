// The Conjunction domain tab (analysis-UX, design section 3, tab 4). Phase 1 wires the REAL
// CDM/OEM/TLE ingestion path (decision 3): a catalog-ingest card parses pasted CCSDS CDM/OEM
// or a TLE set into a screening catalog, a worker screen runs over THAT real catalog (keeping
// the existing progress/cancel UX), and a per-event card computes the full-covariance Pc +
// Max-Pc and renders a B-plane viewer. The single-pair closest-approach card is kept.

import { useState, type ReactNode } from 'react';
import { DomainIcon } from '@bessel/selene-design';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { StatResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import {
  ConjunctionParamsForm,
  DEFAULT_CONJUNCTION_PARAMS,
  type ConjunctionParams,
} from './analysis-tool-forms.tsx';
import { Action, EmptyNotice, Keep, fmt, useAnalysisParams, useTrayFull } from './analysis-shared.tsx';
import { CatalogIngestCard } from './conjunction/CatalogIngestCard.tsx';
import { PcCard } from './conjunction/PcCard.tsx';
import { WatchlistCard } from './conjunction/WatchlistCard.tsx';

export interface ConjunctionPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly expandRequest?: ExpandRequest;
}

export function ConjunctionPanel(props: ConjunctionPanelProps): JSX.Element {
  const { engine, store } = props;
  const params = useAnalysisParams(store, { withTarget: false, withSecondary: true });
  const { secondary, scalarCsv } = params;
  const trayFull = useTrayFull(store);

  const [conj, setConj] = useState<ConjunctionParams>(DEFAULT_CONJUNCTION_PARAMS);

  const runStatus = useStore(store, (s) => s.runStatus);
  const conjunction = useStore(store, (s) => s.conjunction);

  const conjunctionCard = (): ReactNode => (
    <>
      <ConjunctionParamsForm value={conj} onChange={setConj} />
      <Action
        variant="primary"
        status={runStatus['compute-conjunction']}
        onClick={() =>
          void engine?.computeConjunction({
            ...(secondary ? { secondary } : {}),
            sigmaKm: conj.sigmaKm,
            radiusKm: conj.radiusKm,
          })
        }
        testId="compute-conjunction"
      >
        Compute closest approach
      </Action>
      <StatResult
        show={!!conjunction}
        resultTestId="conjunction-result"
        hint="Closest approach and collision probability for the loaded pair."
        csv={
          conjunction
            ? {
                testId: 'conjunction-csv',
                filename: 'conjunction.csv',
                build: () =>
                  scalarCsv([
                    ['pair', conjunction.label],
                    ['miss_km', conjunction.missKm],
                    ['tca_s', conjunction.tcaSec],
                    ['rel_speed_km_s', conjunction.relSpeedKmS],
                    ['pc', conjunction.pc],
                    ['sigma_km', conjunction.sigmaKm],
                    ['hard_body_radius_km', conjunction.radiusKm],
                  ]),
              }
            : undefined
        }
      >
        {conjunction && (
          <>
            {conjunction.label}: miss {fmt(conjunction.missKm)} km at TCA {fmt(conjunction.tcaSec / 60, 1)} min,
            rel speed {fmt(conjunction.relSpeedKmS, 3)} km/s, Pc {conjunction.pc.toExponential(2)}
          </>
        )}
      </StatResult>
      <RunStatusNote status={runStatus['compute-conjunction']} id="compute-conjunction" />
      <Keep domain="conjunction" disabled={!conjunction || trayFull} onKeep={() => engine?.keepSnapshot('conjunction')} />
    </>
  );

  const ingestCard = (): ReactNode => (
    <>
      <CatalogIngestCard engine={engine} store={store} />
      <RunStatusNote status={runStatus['ingest-catalog']} id="ingest-catalog" />
      <RunStatusNote status={runStatus['screen-catalog']} id="screen-catalog" />
    </>
  );

  const pcCard = (): ReactNode => (
    <>
      <PcCard engine={engine} store={store} />
      <RunStatusNote status={runStatus['compute-event-pc']} id="compute-event-pc" />
      <RunStatusNote status={runStatus['supply-covariance']} id="supply-covariance" />
      <RunStatusNote status={runStatus['export-cdm']} id="export-cdm" />
    </>
  );

  const watchlistCard = (): ReactNode => <WatchlistCard engine={engine} store={store} />;

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'catalog-screen',
      title: 'Catalog ingestion & screening',
      purpose: 'Ingest REAL CDM/OEM/TLE, then all-vs-all screen on a worker.',
      status: runStatus['ingest-catalog'],
      icon: <DomainIcon name="conjunction" size="sm" />,
      render: ingestCard,
    },
    {
      id: 'per-event-pc',
      title: 'Per-event Pc & B-plane',
      purpose: 'Full-covariance Pc + Max-Pc and the encounter-plane plot for a flagged event.',
      status: runStatus['compute-event-pc'],
      icon: <DomainIcon name="b-plane" size="sm" />,
      render: pcCard,
    },
    {
      id: 'watchlist',
      title: 'Watchlist',
      purpose: 'Track flagged events and watch their Pc rise or fall on re-screen / covariance.',
      status: runStatus['watch-event'],
      render: watchlistCard,
    },
    {
      id: 'closest-approach',
      title: 'Closest approach (pair)',
      purpose: 'Miss distance, TCA, and collision probability for a single loaded pair.',
      status: runStatus['compute-conjunction'],
      render: conjunctionCard,
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="conjunction-panel">
      <EmptyNotice hasSpacecraft={props.hasSpacecraft} />
      {params.paramsBar}
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['catalog-screen', 'per-event-pc']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
