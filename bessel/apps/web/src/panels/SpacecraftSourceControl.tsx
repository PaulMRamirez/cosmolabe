// The editable spacecraft-source control for the Orbit & Maneuver tab: a TLE / object toggle,
// a TLE paste box (parsed and validated on apply, surfacing the located parse error on
// failure), and a loaded-scene-object picker. Applying a source writes it through the engine
// into scenario.spacecraftSource (mirroring its name into primarySpacecraft), which the
// Propagate card's SGP4 / HPOP runs then read. Replaces the former hardcoded sample TLE.
// (analysis-UX Phase 1, design section 3 tab 1.)

import { useState } from 'react';
import { Button } from '@bessel/selene-design';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { parseTleSource, type SourceMode } from './orbit-source.ts';

export interface SpacecraftSourceControlProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

export function SpacecraftSourceControl(props: SpacecraftSourceControlProps): JSX.Element {
  const { engine, store } = props;
  const source = useStore(store, (s) => s.scenario.spacecraftSource);
  const objects = useStore(store, (s) => s.objects);
  const spacecraftObjects = objects.filter((o) => o.kind === 'spacecraft');

  const [mode, setMode] = useState<SourceMode>('tle');
  const [tleText, setTleText] = useState('');
  const [objectName, setObjectName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const applyTle = (): void => {
    const result = parseTleSource(tleText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    engine?.setSpacecraftSource(result.source);
  };

  const applyObject = (): void => {
    const name = objectName || spacecraftObjects[0]?.name || '';
    if (!name) {
      setError('no loaded scene object to pick; load a mission first');
      return;
    }
    setError(null);
    engine?.setSpacecraftSource({ kind: 'object', name });
  };

  return (
    <div className="bessel-analysis-params" data-testid="sc-source-control">
      <div role="group" aria-label="Spacecraft source mode" style={{ display: 'flex', gap: 6 }}>
        <Button
          variant={mode === 'tle' ? 'primary' : 'secondary'}
          testId="sc-source-tle"
          onClick={() => setMode('tle')}
        >
          Paste TLE
        </Button>
        <Button
          variant={mode === 'object' ? 'primary' : 'secondary'}
          testId="sc-source-object"
          onClick={() => setMode('object')}
        >
          Scene object
        </Button>
      </div>

      {mode === 'tle' ? (
        <label>
          Two-line element set
          <textarea
            data-testid="param-sc-source"
            rows={3}
            value={tleText}
            placeholder={'1 25544U ...\n2 25544 ...'}
            onChange={(ev) => setTleText(ev.target.value)}
          />
        </label>
      ) : (
        <label>
          Loaded scene object
          <select
            data-testid="param-sc-source"
            value={objectName || spacecraftObjects[0]?.name || ''}
            onChange={(ev) => setObjectName(ev.target.value)}
            disabled={spacecraftObjects.length === 0}
          >
            {spacecraftObjects.length === 0 ? (
              <option value="">no spacecraft loaded</option>
            ) : (
              spacecraftObjects.map((o) => (
                <option key={o.id} value={o.name}>
                  {o.name}
                </option>
              ))
            )}
          </select>
        </label>
      )}

      <Button
        variant="primary"
        full
        testId="sc-source-apply"
        onClick={() => (mode === 'tle' ? applyTle() : applyObject())}
      >
        Set spacecraft source
      </Button>

      {error ? (
        <p className="bessel-analysis-error" data-testid="sc-source-error" role="alert">
          {error}
        </p>
      ) : null}
      {source ? (
        <p className="bessel-analysis-stat" data-testid="sc-source-active">
          Source: {source.name} ({source.kind === 'tle' ? 'TLE' : 'scene object'})
        </p>
      ) : (
        <p className="bessel-loader-hint" data-testid="sc-source-hint">
          Set a spacecraft source (paste a TLE or pick a scene object) to propagate.
        </p>
      )}
    </div>
  );
}
