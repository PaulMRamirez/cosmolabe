// The editable mission-design workbench: the user builds a Mission Control Sequence by
// adding / removing / reordering segments (InitialState / Propagate / Maneuver / Target with
// its goal) in the segment editor, runs the differential corrector via @bessel/propagator,
// and sees the solved arc drawn in the 3D scene plus a report: the per-iteration residual
// convergence, the solved delta-v, the final state, and the goal residuals. Presentational:
// it edits an EditableMcs through the pure reducer and calls the engine. (STK_PARITY_SPEC §4.3;
// analysis-UX Phase 1.)

import { useCallback, useMemo } from 'react';
import { Button } from '@bessel/selene-design';
import { TimeSeriesChart } from '@bessel/ui';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { RunStatusNote, busyLabel } from './RunStatus.tsx';
import { McsSegmentEditor } from './McsSegmentEditor.tsx';
import { Keep, useTrayFull } from './analysis-shared.tsx';
import { mcsEditorReducer, type McsEditorAction } from '../engine/mcs-editor.ts';

export interface MissionPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

export function MissionPanel(props: MissionPanelProps): JSX.Element {
  const { engine, store } = props;
  const result = useStore(store, (s) => s.mcsResult);
  const runStatus = useStore(store, (s) => s.runStatus);
  const trayFull = useTrayFull(store);
  const run = busyLabel(runStatus['run-mcs'], 'Run mission sequence', 'Computing...');
  // [ux-p2-orbit] The editable MCS lives in the store so the porkchop "send to MCS" hop and this
  // editor share one design; edits dispatch through the same pure reducer over the store slice.
  const design = useStore(store, (s) => s.editableMcs);
  const dispatch = useCallback(
    (action: McsEditorAction): void => {
      store.setState((s) => ({ editableMcs: mcsEditorReducer(s.editableMcs, action) }));
    },
    [store],
  );

  // The residual convergence trace plotted as residual-norm vs iteration (iter on the x axis).
  const residualChart = useMemo(() => {
    const h = result?.residualHistory ?? [];
    return {
      iter: Float64Array.from(h.map((p) => p.iter)),
      normF: Float64Array.from(h.map((p) => p.normF)),
    };
  }, [result]);

  return (
    <div className="bessel-analysis" data-testid="mission-design-panel">
      <McsSegmentEditor design={design} dispatch={dispatch} />

      <Button
        variant="primary"
        full
        testId="run-mcs"
        disabled={run.disabled}
        onClick={() => void engine?.runEditableMcs(design)}
      >
        {run.label}
      </Button>
      <RunStatusNote status={runStatus['run-mcs']} id="run-mcs" />

      {result ? (
        <div data-testid="mcs-result">
          <p className="bessel-analysis-stat" data-testid="mcs-final-state">
            {result.label}: final radius {fmt(result.finalRadiusKm, 1)} km, speed{' '}
            {fmt(result.finalSpeedKmS, 4)} km/s
          </p>
          {result.converged === null ? (
            <p className="bessel-analysis-stat" data-testid="mcs-dc-report">
              No targeting segment ran.
            </p>
          ) : (
            <p className="bessel-analysis-stat" data-testid="mcs-dc-report">
              Differential corrector {result.converged ? 'converged' : 'did not converge'} in{' '}
              {result.iterations} iteration{result.iterations === 1 ? '' : 's'}
              {result.solvedDvKmS !== null ? (
                <span data-testid="mcs-solved-dv">; solved delta-v {fmt(result.solvedDvKmS, 4)} km/s</span>
              ) : null}
              {result.goals.map((g, i) => (
                <span key={i}>
                  {' '}
                  ({g.type}: achieved {fmt(g.achieved, 1)}, desired {fmt(g.desired, 1)}, residual{' '}
                  {fmt(g.residual, 4)})
                </span>
              ))}
            </p>
          )}
          {residualChart.iter.length > 0 ? (
            <div data-testid="mcs-residuals">
              <div className="bessel-panel-title">Corrector residual norm vs iteration</div>
              <TimeSeriesChart
                et={residualChart.iter}
                value={residualChart.normF}
                label="residual norm"
                testId="mcs-residuals-chart"
              />
            </div>
          ) : null}
          <div className="bessel-panel-title">{result.altitude.label}</div>
          <TimeSeriesChart
            et={result.altitude.et}
            value={result.altitude.value}
            label={result.altitude.label}
            testId="mcs-altitude-chart"
          />
          <Keep domain="orbit-mcs" disabled={trayFull} onKeep={() => engine?.keepSnapshot('orbit-mcs')} />
        </div>
      ) : (
        <p className="bessel-loader-hint">
          Build and run a Mission Control Sequence; the solved arc renders in the scene and the
          differential-corrector convergence and solved delta-v appear here.
        </p>
      )}
    </div>
  );
}
