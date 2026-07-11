// The explicit COVARIANCE INPUT form (analysis-UX Phase 2, decision 1). When the ingested
// catalog did NOT carry a covariance for the selected event's objects (an OEM or a TLE set),
// the analyst supplies an assumed position covariance here so the per-event card can report a
// FULL-covariance Pc instead of only the Max-Pc bound. The form supplies a 3x3 position
// covariance for a chosen object (the selected event's primary or secondary) in either the RTN
// local frame or the inertial J2000 frame, entered as three per-axis sigmas (a diagonal
// covariance) or, in advanced mode, the six independent entries of a full symmetric 3x3. The
// engine validates + rotates it (fail loud on a non-PD matrix) and recomputes the Pc. Presentational.

import { useState } from 'react';
import { Button } from '@bessel/selene-design';
import type { BesselEngine } from '../../engine/index.ts';
import { useStore, type AppStore } from '../../store/index.ts';
import type { CovarianceFrame } from '../../engine/analysis-ops.ts';
import { Action } from '../analysis-shared.tsx';

/** Build a row-major 3x3 (length 9) from three per-axis sigmas (km): diag(sigma^2). */
function diag3(sR: number, sT: number, sN: number): number[] {
  return [sR * sR, 0, 0, 0, sT * sT, 0, 0, 0, sN * sN];
}

/** Build a symmetric row-major 3x3 from the six independent entries (the upper triangle). */
function full3(c00: number, c01: number, c02: number, c11: number, c12: number, c22: number): number[] {
  return [c00, c01, c02, c01, c11, c12, c02, c12, c22];
}

const FRAME_LABEL: Record<CovarianceFrame, string> = { rtn: 'RTN (radial/transverse/normal)', inertial: 'Inertial (J2000)' };

export function CovarianceInputForm(props: {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  /** The two object ids the analyst may supply a covariance for (the selected event's pair). */
  readonly primaryId: string;
  readonly secondaryId: string;
}): JSX.Element {
  const { engine, store, primaryId, secondaryId } = props;
  const supplied = useStore(store, (s) => s.conjunctionSuppliedCovariances);
  const runStatus = useStore(store, (s) => s.runStatus);
  const status = runStatus['supply-covariance'];
  const error = typeof status === 'object' ? status.error : null;

  const [objectId, setObjectId] = useState(primaryId);
  const [frame, setFrame] = useState<CovarianceFrame>('rtn');
  const [advanced, setAdvanced] = useState(false);
  // Per-axis sigmas (km) for the diagonal form.
  const [sR, setSR] = useState(0.5);
  const [sT, setST] = useState(0.5);
  const [sN, setSN] = useState(0.5);
  // The six independent entries (km^2) for the full-matrix form.
  const [c00, setC00] = useState(0.25);
  const [c01, setC01] = useState(0);
  const [c02, setC02] = useState(0);
  const [c11, setC11] = useState(0.25);
  const [c12, setC12] = useState(0);
  const [c22, setC22] = useState(0.25);

  const submit = (): void => {
    const matrix3 = advanced ? full3(c00, c01, c02, c11, c12, c22) : diag3(sR, sT, sN);
    void engine?.setSuppliedCovariance(objectId, { matrix3, frame });
  };

  const num = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    testId: string,
    min?: number,
  ): JSX.Element => (
    <label>
      {label}
      <input
        type="number"
        step="any"
        {...(min !== undefined ? { min } : {})}
        value={value}
        onChange={(ev) => onChange(Number(ev.target.value))}
        data-testid={testId}
      />
    </label>
  );

  return (
    <div className="bessel-covariance-input" data-testid="covariance-input">
      <p className="bessel-loader-hint">
        This catalog carried no covariance for the selected pair. Supply an assumed position
        covariance to get a full-covariance Pc (not just Max-Pc).
      </p>
      <div className="bessel-analysis-params">
        <label>
          Object
          <select value={objectId} onChange={(ev) => setObjectId(ev.target.value)} data-testid="cov-object">
            <option value={primaryId}>{primaryId} (primary)</option>
            <option value={secondaryId}>{secondaryId} (secondary)</option>
          </select>
        </label>
        <label>
          Frame
          <select
            value={frame}
            onChange={(ev) => setFrame(ev.target.value as CovarianceFrame)}
            data-testid="cov-frame"
          >
            {(['rtn', 'inertial'] as const).map((f) => (
              <option key={f} value={f}>
                {FRAME_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {advanced ? (
        <div className="bessel-analysis-params" data-testid="cov-matrix">
          {num('C₀₀ (km²)', c00, setC00, 'param-cov-c00')}
          {num('C₀₁', c01, setC01, 'param-cov-c01')}
          {num('C₀₂', c02, setC02, 'param-cov-c02')}
          {num('C₁₁ (km²)', c11, setC11, 'param-cov-c11')}
          {num('C₁₂', c12, setC12, 'param-cov-c12')}
          {num('C₂₂ (km²)', c22, setC22, 'param-cov-c22')}
        </div>
      ) : (
        <div className="bessel-analysis-params">
          {num('σ radial (km)', sR, setSR, 'param-cov-sigma', 0)}
          {num('σ transverse (km)', sT, setST, 'param-cov-sigma-t', 0)}
          {num('σ normal (km)', sN, setSN, 'param-cov-sigma-n', 0)}
        </div>
      )}

      <div className="bessel-ingest-actions">
        <Button
          variant="ghost"
          testId="cov-toggle-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? 'Use per-axis sigmas' : 'Enter full 3x3'}
        </Button>
        <Action variant="primary" status={status} onClick={submit} testId="cov-apply">
          Apply covariance
        </Action>
        {supplied.includes(objectId) ? (
          <Button variant="ghost" testId="cov-clear" onClick={() => void engine?.clearSuppliedCovariance(objectId)}>
            Clear
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="bessel-analysis-error" data-testid="cov-error">
          Covariance rejected: {error}
        </p>
      ) : null}
      {supplied.length > 0 ? (
        <p className="bessel-analysis-stat" data-testid="cov-supplied-summary">
          Supplied covariance for: {supplied.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
