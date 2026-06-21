// The mission-design workbench surfaced in the viewer's "Mission Design" menu. The user
// assembles a small Mission Control Sequence (an initial LEO state, a coast, an impulsive
// prograde burn, then a Target whose differential corrector tunes the burn to reach a
// desired radius), runs it via @bessel/propagator, and sees the propagated arc drawn in
// the 3D scene plus a report (final state and the corrector convergence). Presentational:
// it reads the mcsResult slice and calls the engine. (STK_PARITY_SPEC §4.3.)

import { useState } from 'react';
import { Button, Tag } from '@bessel/selene-design';
import { TimeSeriesChart } from '@bessel/ui';
import { type BesselEngine, DEFAULT_MCS_DESIGN, type McsDesign } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { RunStatusNote, busyLabel } from './RunStatus.tsx';

export interface MissionPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

export function MissionPanel(props: MissionPanelProps): JSX.Element {
  const { engine, store } = props;
  const result = useStore(store, (s) => s.mcsResult);
  const objects = useStore(store, (s) => s.objects);
  const runStatus = useStore(store, (s) => s.runStatus);
  const isSample = !objects.some((e) => e.kind === 'spacecraft');
  const run = busyLabel(runStatus['run-mcs'], 'Run mission sequence', 'Computing...');
  const [design, setDesign] = useState<McsDesign>(DEFAULT_MCS_DESIGN);

  const set = <K extends keyof McsDesign>(key: K, value: number): void =>
    setDesign((d) => ({ ...d, [key]: value }));

  return (
    <div className="bessel-analysis" data-testid="mission-design-panel">
      <div className="bessel-analysis-params" data-testid="mcs-params">
        <label>
          Initial altitude (km)
          <input
            type="number"
            min={100}
            step={50}
            value={design.altitudeKm}
            onChange={(ev) => set('altitudeKm', Math.max(100, Number(ev.target.value)))}
            data-testid="mcs-altitude-km"
          />
        </label>
        <label>
          Coast before burn (s)
          <input
            type="number"
            min={60}
            step={60}
            value={design.propDurationSec}
            onChange={(ev) => set('propDurationSec', Math.max(60, Number(ev.target.value)))}
            data-testid="mcs-prop-duration"
          />
        </label>
        <label>
          Prograde delta-v (km/s)
          <input
            type="number"
            min={0}
            step={0.01}
            value={design.dvKmS}
            onChange={(ev) => set('dvKmS', Math.max(0, Number(ev.target.value)))}
            data-testid="mcs-dv"
          />
        </label>
        <label>
          Target radius (km)
          <input
            type="number"
            min={6500}
            step={100}
            value={design.targetRadiusKm}
            onChange={(ev) => set('targetRadiusKm', Math.max(6500, Number(ev.target.value)))}
            data-testid="mcs-target-radius"
          />
        </label>
      </div>

      <Button
        variant="primary"
        full
        testId="run-mcs"
        disabled={run.disabled}
        onClick={() => void engine?.runMcsDesign(design)}
      >
        {run.label}
      </Button>
      <RunStatusNote status={runStatus['run-mcs']} id="run-mcs" />

      {result ? (
        <div data-testid="mcs-result">
          {isSample ? (
            <span data-testid="sample-data-tag" style={{ display: 'inline-flex', marginBottom: 4 }}>
              <Tag tone="amber">Sample data</Tag>
            </span>
          ) : null}
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
              {result.goals.map((g, i) => (
                <span key={i}>
                  {' '}
                  ({g.type}: achieved {fmt(g.achieved, 1)}, desired {fmt(g.desired, 1)}, residual{' '}
                  {fmt(g.residual, 4)})
                </span>
              ))}
            </p>
          )}
          <div className="bessel-panel-title">{result.altitude.label}</div>
          <TimeSeriesChart
            et={result.altitude.et}
            value={result.altitude.value}
            label={result.altitude.label}
            testId="mcs-altitude-chart"
          />
        </div>
      ) : (
        <p className="bessel-loader-hint">
          Assemble and run a Mission Control Sequence; the propagated arc renders in the
          scene and the differential-corrector report appears here.
        </p>
      )}
    </div>
  );
}
