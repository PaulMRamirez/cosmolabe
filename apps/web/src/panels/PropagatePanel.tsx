// The propagation workbench: ingest a TLE, run SGP4, publish an in-memory SPK Type-13
// about the Earth, and read the arc back through the geometry pipeline as an altitude
// time series and a ground track. Mission-independent (it propagates Earth orbits
// from element sets), so it is always available, not gated on a loaded spacecraft.
// (STK_PARITY_SPEC §4.1, Phase A.)

import { useState } from 'react';
import { Button, Tag } from '@bessel/selene-design';
import { GroundTrackMap, IntervalTimeline, TimeSeriesChart, downloadBlob } from '@bessel/ui';
import { intervalsToCsv } from '@bessel/interop';
import { type BesselEngine, type HpopForceModel } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { RunStatusNote, busyLabel } from './RunStatus.tsx';

// The HPOP force-model fidelity choices, in increasing order of physics modeled.
const HPOP_MODELS: readonly { value: HpopForceModel; label: string }[] = [
  { value: 'point-mass', label: 'Point mass (2-body)' },
  { value: 'j2', label: 'Point mass + J2' },
  { value: 'nxn', label: 'NxN gravity (zonal J2-J4)' },
  { value: 'drag', label: 'NxN gravity + drag' },
  { value: 'srp', label: 'NxN gravity + drag + SRP' },
];

export interface PropagatePanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

const fmt = (n: number, digits = 1): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

export function PropagatePanel(props: PropagatePanelProps): JSX.Element {
  const { engine, store } = props;
  const tleOrbit = useStore(store, (s) => s.tleOrbit);
  const stationAccess = useStore(store, (s) => s.stationAccess);
  const hpopAltitude = useStore(store, (s) => s.hpopAltitude);
  const objects = useStore(store, (s) => s.objects);
  const runStatus = useStore(store, (s) => s.runStatus);
  const isSample = !objects.some((e) => e.kind === 'spacecraft');
  const [hpopModel, setHpopModel] = useState<HpopForceModel>('j2');
  const tleBtn = busyLabel(runStatus['propagate-tle'], 'Propagate sample TLE (SGP4)', 'Computing...');

  return (
    <div className="bessel-analysis" data-testid="propagate-panel">
      <Button
        variant="primary"
        full
        testId="propagate-tle"
        disabled={tleBtn.disabled}
        onClick={() => void engine?.propagateTle()}
      >
        {tleBtn.label}
      </Button>
      <RunStatusNote status={runStatus['propagate-tle']} id="propagate-tle" />
      {tleOrbit ? (
        <div data-testid="tle-result">
          {isSample ? (
            <span data-testid="sample-data-tag" style={{ display: 'inline-flex', marginBottom: 4 }}>
              <Tag tone="amber">Sample data</Tag>
            </span>
          ) : null}
          <p className="bessel-analysis-stat" data-testid="tle-period">
            {tleOrbit.label}: period {tleOrbit.periodMin.toFixed(1)} min
          </p>
          <div className="bessel-panel-title">{tleOrbit.altitude.label}</div>
          <TimeSeriesChart
            et={tleOrbit.altitude.et}
            value={tleOrbit.altitude.value}
            label={tleOrbit.altitude.label}
            testId="tle-altitude-chart"
          />
          <div className="bessel-panel-title">{tleOrbit.track.label}</div>
          <GroundTrackMap
            lon={tleOrbit.track.lon}
            lat={tleOrbit.track.lat}
            label={tleOrbit.track.label}
            testId="tle-ground-track"
          />
          <Button
            variant="primary"
            full
            testId="compute-station-access"
            disabled={runStatus['compute-station-access'] === 'running'}
            onClick={() => void engine?.computeStationAccess()}
          >
            {runStatus['compute-station-access'] === 'running'
              ? 'Computing...'
              : 'Ground-station access (Goldstone, 10 deg, sunlit)'}
          </Button>
          <RunStatusNote status={runStatus['compute-station-access']} id="compute-station-access" />
          {stationAccess ? (
            <div data-testid="station-access-result">
              <div className="bessel-panel-title">{stationAccess.label}</div>
              <IntervalTimeline
                intervals={stationAccess.window}
                span={stationAccess.span}
                label={stationAccess.label}
                testId="station-access-timeline"
              />
              <p className="bessel-analysis-stat" data-testid="station-access-fom">
                {stationAccess.fom.accessCount} pass
                {stationAccess.fom.accessCount === 1 ? '' : 'es'}, {fmt(stationAccess.fom.percentCoverage * 100)}% of the day
              </p>
              <Button
                variant="secondary"
                className="bessel-csv-button"
                testId="station-access-csv"
                onClick={() =>
                  downloadBlob(
                    new Blob(
                      [
                        intervalsToCsv(stationAccess.window, {
                          meta: { frame: 'J2000', timeSystem: 'UTC', target: 'Goldstone' },
                        }),
                      ],
                      { type: 'text/csv' },
                    ),
                    'station-access.csv',
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          ) : (
            <p className="bessel-loader-hint">Find visible passes over a ground station.</p>
          )}
          <label>
            HPOP force model
            <select
              value={hpopModel}
              onChange={(ev) => setHpopModel(ev.target.value as HpopForceModel)}
              data-testid="hpop-force-model"
            >
              {HPOP_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="bessel-loader-hint" data-testid="hpop-frame-note">
            Frame note: the TLE state is TEME, integrated as J2000 (an arcminute-scale
            approximation near the epoch). SGP4 output is TEME -&gt; J2000.
          </p>
          <Button
            variant="primary"
            full
            testId="propagate-hpop"
            disabled={runStatus['propagate-hpop'] === 'running'}
            onClick={() => void engine?.propagateHpop(hpopModel)}
          >
            {runStatus['propagate-hpop'] === 'running' ? 'Computing...' : 'Propagate numerically (HPOP)'}
          </Button>
          <RunStatusNote status={runStatus['propagate-hpop']} id="propagate-hpop" />
          {hpopAltitude ? (
            <div data-testid="hpop-result">
              <div className="bessel-panel-title">{hpopAltitude.label}</div>
              <TimeSeriesChart
                et={hpopAltitude.et}
                value={hpopAltitude.value}
                label={hpopAltitude.label}
                testId="hpop-altitude-chart"
              />
            </div>
          ) : (
            <p className="bessel-loader-hint">
              Integrate the TLE state with the native Cowell propagator (DOPRI5 + J2).
            </p>
          )}
        </div>
      ) : (
        <p className="bessel-loader-hint">
          Propagate the bundled TLE with SGP4 into an SPK and plot its altitude and ground track.
        </p>
      )}
    </div>
  );
}
