// The catalog-ingestion card: a format selector (CDM / OEM / TLE) and a textarea that ingests
// REAL pasted CCSDS CDM/OEM or a TLE set into the conjunction screening catalog (analysis-UX
// Phase 1, decision 3), then screens that ingested catalog on the dedicated worker with
// configurable thresholds (reusing the existing progress/cancel UX). Pasting is the ingestion
// path: the web shell's PAL FileSystem is not wired for an arbitrary local upload here, so the
// card accepts pasted text (still REAL parsing via parseCdm/parseOem/parseTle, not synthetic).
// A per-format sample button loads a small valid document so the flow is runnable end to end.

import { useState } from 'react';
import { Button } from '@bessel/selene-design';
import type { BesselEngine } from '../../engine/index.ts';
import { useStore, type AppStore, type RunStatus } from '../../store/index.ts';
import type { IngestFormat } from '../../engine/analysis-ops.ts';
import { Action, fmt } from '../analysis-shared.tsx';
import { SAMPLE_CDM, SAMPLE_OEM, SAMPLE_TLE_SET } from './sample-ingest.ts';

const FORMAT_LABEL: Record<IngestFormat, string> = { cdm: 'CCSDS CDM', oem: 'CCSDS OEM', tle: 'TLE set' };
const SAMPLE: Record<IngestFormat, string> = { cdm: SAMPLE_CDM, oem: SAMPLE_OEM, tle: SAMPLE_TLE_SET };

export function CatalogIngestCard(props: {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}): JSX.Element {
  const { engine, store } = props;
  const [format, setFormat] = useState<IngestFormat>('cdm');
  const [text, setText] = useState('');
  const [thresholdKm, setThresholdKm] = useState(5);
  const [padKm, setPadKm] = useState(50);

  const runStatus = useStore(store, (s) => s.runStatus);
  const ingest = useStore(store, (s) => s.conjunctionIngest);
  const screening = useStore(store, (s) => s.screening);

  const ingestStatus = runStatus['ingest-catalog'];
  const ingestError = typeof ingestStatus === 'object' ? ingestStatus.error : null;
  const screenRunning = screening.status === 'running';
  const screenError = typeof screening.status === 'object' ? screening.status.error : null;

  return (
    <div className="bessel-ingest" data-testid="ingest-catalog">
      <label>
        Format
        <select
          value={format}
          onChange={(ev) => setFormat(ev.target.value as IngestFormat)}
          data-testid="ingest-format"
        >
          {(['cdm', 'oem', 'tle'] as const).map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="bessel-ingest-input">
        Paste {FORMAT_LABEL[format]} text
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={`Paste a ${FORMAT_LABEL[format]} document here`}
          data-testid="ingest-input"
        />
      </label>
      <div className="bessel-ingest-actions">
        <Button variant="ghost" testId="ingest-sample" onClick={() => setText(SAMPLE[format])}>
          Load sample
        </Button>
        <Action
          variant="primary"
          status={ingestStatus}
          disabled={text.trim() === ''}
          onClick={() => void engine?.ingestConjunctionCatalog(format, text)}
          testId="ingest-run"
        >
          Ingest catalog
        </Action>
      </div>
      {ingestError ? (
        <p className="bessel-analysis-error" data-testid="ingest-error">
          Ingest failed: {ingestError}
        </p>
      ) : null}
      {ingest ? (
        <p className="bessel-analysis-stat" data-testid="ingest-summary">
          Ingested {ingest.objectCount} {ingest.format.toUpperCase()} object{ingest.objectCount === 1 ? '' : 's'} (
          {ingest.covarianceCount} with covariance): {ingest.ids.join(', ')}.
        </p>
      ) : (
        <p className="bessel-loader-hint">
          Ingest REAL CCSDS CDM/OEM or a TLE set into the screening catalog, then screen it on the worker.
        </p>
      )}

      {/* Threshold controls for the screen of the ingested catalog. */}
      <div className="bessel-analysis-params">
        <label>
          Threshold (km)
          <input
            type="number"
            min={0.01}
            step={1}
            value={thresholdKm}
            onChange={(ev) => setThresholdKm(Math.max(0.01, Number(ev.target.value)))}
            data-testid="screen-threshold-km"
          />
        </label>
        <label>
          Sieve pad (km)
          <input
            type="number"
            min={0}
            step={5}
            value={padKm}
            onChange={(ev) => setPadKm(Math.max(0, Number(ev.target.value)))}
            data-testid="screen-pad-km"
          />
        </label>
      </div>
      <ScreenIngested
        engine={engine}
        runStatus={runStatus['screen-catalog']}
        running={screenRunning}
        canScreen={!!ingest && ingest.objectCount >= 2}
        thresholdKm={thresholdKm}
        padKm={padKm}
      />
      {screenError ? (
        <p className="bessel-analysis-error" data-testid="screen-error">
          Screen failed: {screenError}
        </p>
      ) : null}
      {screenRunning ? (
        <>
          <p className="bessel-analysis-stat" data-testid="screen-progress">
            Screening {screening.done}/{screening.total} primaries...
          </p>
          <Button variant="ghost" testId="screen-cancel" onClick={() => void engine?.cancelScreen()}>
            Cancel
          </Button>
        </>
      ) : null}
      {screening.events && screening.events.length === 0 && screening.status === 'done' ? (
        <p className="bessel-analysis-stat" data-testid="screen-events-empty">
          No conjunctions flagged below {fmt(thresholdKm)} km.
        </p>
      ) : null}
    </div>
  );
}

/** The screen action for the ingested catalog (disabled until a >=2-object catalog is ingested). */
function ScreenIngested(props: {
  readonly engine: BesselEngine | null;
  readonly runStatus: RunStatus | undefined;
  readonly running: boolean;
  readonly canScreen: boolean;
  readonly thresholdKm: number;
  readonly padKm: number;
}): JSX.Element {
  return (
    <Action
      status={props.running ? 'running' : props.runStatus}
      disabled={!props.canScreen}
      onClick={() =>
        void props.engine?.screenIngestedCatalog({ thresholdKm: props.thresholdKm, padKm: props.padKm })
      }
      testId="screen-catalog"
    >
      Screen ingested catalog (worker)
    </Action>
  );
}
