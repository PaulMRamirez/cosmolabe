// The Coverage & Constellation domain tab (design section 3, tab 5): the connected
// Walker -> sweep -> metric-aware contour workflow. The Walker designer renders as orbit
// rings AND publishes its members as the swept ASSET SET; the sweep form drives grid
// resolution, region, the FOM metric to color by, and the N-fold k; the result is a
// metric-aware contour (legend) plus a regional FOM summary table with CSV. Presentational.

import { useState, type ReactNode } from 'react';
import { Button, DomainIcon } from '@bessel/selene-design';
import { downloadBlob } from '@bessel/ui';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import type { CoverageMetricId } from '../engine/coverage-metric.ts';
import { StatResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import { ContourLegend, FomSummaryTable, coverageSummaryRows } from './coverage-result.tsx';
import {
  ConstellationParamsForm,
  CoverageSweepForm,
  isValidWalker,
  DEFAULT_CONSTELLATION_PARAMS,
  DEFAULT_COVERAGE_SWEEP_PARAMS,
  type ConstellationFormParams,
  type CoverageSweepFormParams,
} from './analysis-tool-forms.tsx';
import { Action, EmptyNotice, Keep, fmt, useAnalysisParams, useTrayFull } from './analysis-shared.tsx';

export interface CoveragePanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly expandRequest?: ExpandRequest;
}

/** Whether two flat param objects are equal (same keys, same primitive values), so a
 *  form's Reset can disable when its inputs already match the module defaults. */
function sameParams<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export function CoveragePanel(props: CoveragePanelProps): JSX.Element {
  const { engine, store } = props;
  const params = useAnalysisParams(store, { withTarget: false, withSecondary: false });
  const { span, scalarCsv } = params;

  const [constellationParams, setConstellationParams] =
    useState<ConstellationFormParams>(DEFAULT_CONSTELLATION_PARAMS);
  const [sweepParams, setSweepParams] = useState<CoverageSweepFormParams>(DEFAULT_COVERAGE_SWEEP_PARAMS);
  // Gate the constellation run on a buildable T/P so a valid-looking pair that does not
  // divide cannot fail silently inside walkerConstellation.
  const constellationValid = isValidWalker(constellationParams.totalSats, constellationParams.planes);

  const runStatus = useStore(store, (s) => s.runStatus);
  const constellation = useStore(store, (s) => s.constellation);
  const designed = useStore(store, (s) => s.designedConstellation);
  const coverageGrid = useStore(store, (s) => s.coverageGrid);
  const coverageSweep = useStore(store, (s) => s.coverageSweep);
  const trayFull = useTrayFull(store);
  // [ux-p3-coverage] The sweep runs on the dedicated coverage worker: while it runs, show a live
  // cells-done/total readout and a cancel control (the worker, and its nested SPICE worker, are
  // terminated) so a 24-satellite global sweep never stalls the UI.
  const sweepRunning = coverageSweep.status === 'running';

  const runSweep = (): void => {
    void engine?.computeCoverageGrid({
      ...span,
      latCount: sweepParams.latCount,
      lonCount: sweepParams.lonCount,
      latMinDeg: sweepParams.latMinDeg,
      latMaxDeg: sweepParams.latMaxDeg,
      lonMinDeg: sweepParams.lonMinDeg,
      lonMaxDeg: sweepParams.lonMaxDeg,
      metric: sweepParams.metric as CoverageMetricId,
      nFoldK: sweepParams.nFoldK,
      minElevationDeg: 5,
    });
  };

  const exportFomCsv = (): void => {
    const summary = store.getState().coverageGrid?.summary;
    if (!summary) return;
    const csv = scalarCsv(coverageSummaryRows(summary));
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'coverage-fom.csv');
  };

  const constellationCard = (): ReactNode => (
    <>
      <ConstellationParamsForm value={constellationParams} onChange={setConstellationParams} />
      <Button
        variant="ghost"
        testId="coverage-constellation-reset"
        disabled={sameParams(constellationParams, DEFAULT_CONSTELLATION_PARAMS)}
        onClick={() => setConstellationParams({ ...DEFAULT_CONSTELLATION_PARAMS })}
      >
        Reset
      </Button>
      <Action
        variant="primary"
        status={runStatus['compute-constellation']}
        disabled={!constellationValid}
        onClick={() => void engine?.computeConstellation(constellationParams)}
        testId="compute-constellation"
      >
        Design Walker constellation
      </Action>
      {!constellationValid ? (
        <p className="bessel-loader-hint" data-testid="constellation-invalid">
          Total sats (T) must be a positive multiple of the number of planes (P).
        </p>
      ) : null}
      <StatResult
        show={!!constellation}
        resultTestId="constellation-result"
        hint="Generate a Walker constellation; it renders as orbit rings and becomes the swept asset set."
        csv={
          constellation
            ? {
                testId: 'constellation-csv',
                filename: 'constellation.csv',
                build: () =>
                  scalarCsv([
                    ['pattern', constellation.pattern],
                    ['total_sats', constellation.totalSats],
                    ['planes', constellation.planes],
                    ['phasing', constellation.phasing],
                    ['per_plane', constellation.perPlane],
                    ['inclination_deg', constellation.inclinationDeg],
                    ['altitude_km', constellation.altitudeKm],
                  ]),
              }
            : undefined
        }
      >
        {constellation && (
          <>
            Walker {constellation.pattern} {constellation.totalSats}/{constellation.planes}/{constellation.phasing}:
            {' '}{constellation.perPlane} sats x {constellation.planes} planes at {fmt(constellation.altitudeKm, 0)} km,
            {' '}{fmt(constellation.inclinationDeg, 0)} deg.
            {designed ? ` ${designed.assetIds.length} assets published for the sweep.` : ''}
          </>
        )}
      </StatResult>
      <RunStatusNote status={runStatus['compute-constellation']} id="compute-constellation" />
    </>
  );

  const assetNote = designed
    ? `Sweeping the ${designed.assetIds.length}-satellite Walker asset set.`
    : 'Sweeping the loaded spacecraft (design a constellation to sweep its members).';

  const gridCard = (): ReactNode => (
    <>
      <p className="bessel-loader-hint" data-testid="coverage-asset-note">
        {assetNote}
      </p>
      <CoverageSweepForm value={sweepParams} onChange={setSweepParams} />
      <Button
        variant="ghost"
        testId="coverage-grid-reset"
        disabled={sameParams(sweepParams, DEFAULT_COVERAGE_SWEEP_PARAMS)}
        onClick={() => setSweepParams({ ...DEFAULT_COVERAGE_SWEEP_PARAMS })}
      >
        Reset
      </Button>
      <Action
        variant="primary"
        status={runStatus['compute-coverage-grid']}
        disabled={sweepRunning}
        onClick={runSweep}
        testId="compute-coverage-grid"
      >
        Run coverage sweep
      </Action>
      {sweepRunning ? (
        <>
          <p className="bessel-analysis-stat" data-testid="coverage-progress">
            Sweeping {coverageSweep.done}/{coverageSweep.total} cells...
          </p>
          <Action onClick={() => void engine?.cancelCoverageGrid()} testId="coverage-cancel">
            Cancel
          </Action>
        </>
      ) : null}
      {typeof coverageSweep.status === 'object' ? (
        <p className="bessel-analysis-error" data-testid="coverage-sweep-error">
          Coverage sweep failed: {coverageSweep.status.error}
        </p>
      ) : null}
      {coverageGrid ? (
        <>
          <p className="bessel-analysis-stat" data-testid="coverage-grid-stat">
            {coverageGrid.label}: {fmt(coverageGrid.areaWeightedPercentCoverage * 100, 1)}% area-weighted coverage
            over {coverageGrid.cellCount} cells.
          </p>
          {coverageGrid.metric ? <ContourLegend metric={coverageGrid.metric} /> : null}
          {coverageGrid.summary ? (
            <FomSummaryTable summary={coverageGrid.summary} onExportCsv={exportFomCsv} />
          ) : null}
        </>
      ) : (
        <p className="bessel-loader-hint">
          Sweep a coverage figure-of-merit grid over the asset set and color the contour by the selected metric.
        </p>
      )}
      <Action
        status={runStatus['clear-coverage-grid']}
        disabled={!coverageGrid}
        onClick={() => void engine?.clearCoverageGrid()}
        testId="clear-coverage-grid"
      >
        Clear coverage grid
      </Action>
      <Keep
        domain="coverage"
        disabled={!coverageGrid || trayFull}
        onKeep={() => engine?.keepSnapshot('coverage')}
      />
      <RunStatusNote status={runStatus['compute-coverage-grid']} id="compute-coverage-grid" />
    </>
  );

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'constellation',
      icon: <DomainIcon name="walker-constellation" size="sm" />,
      title: 'Walker constellation',
      purpose: 'Design a Walker T/P/F constellation that feeds the sweep.',
      status: runStatus['compute-constellation'],
      render: constellationCard,
    },
    {
      id: 'coverage-grid',
      icon: <DomainIcon name="coverage-grid" size="sm" />,
      title: 'Coverage sweep',
      purpose: 'Metric-aware coverage contour + FOM summary over the asset set.',
      status: runStatus['compute-coverage-grid'],
      render: gridCard,
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="coverage-panel">
      <EmptyNotice hasSpacecraft={props.hasSpacecraft} />
      {params.paramsBar}
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['constellation', 'coverage-grid']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
