// The per-event Pc card: the Pc-colored, sortable table of screened events; clicking a row
// computes the FULL-covariance Pc (combinedEncounterCovariance -> propagateCovarianceToTca ->
// collisionProbabilityCov) plus the Max-Pc bound from the ingested covariances and renders the
// BPlaneView. Reuses the screened events off the store's screening slice and the per-event
// result off conjunctionEvent. Presentational; the engine ops do the math.

import { useMemo, useState } from 'react';
import { Button } from '@bessel/selene-design';
import type { ConjunctionEvent } from '@bessel/conjunction';
import type { BesselEngine } from '../../engine/index.ts';
import { useStore, type AppStore, type ConjunctionEventResult } from '../../store/index.ts';
import { Keep, fmt, useTrayFull } from '../analysis-shared.tsx';
import { BPlaneView } from './BPlaneView.tsx';
import { CovarianceInputForm } from './CovarianceInputForm.tsx';
import { RescreenCard } from './RescreenCard.tsx';

type SortKey = 'tca' | 'missKm' | 'pc';

/** A Pc-driven risk band -> CSS class, for the table cell coloring. Null Pc reads as "unknown". */
function pcClass(pc: number | null): string {
  if (pc === null) return 'bessel-pc-unknown';
  if (pc >= 1e-4) return 'bessel-pc-high';
  if (pc >= 1e-6) return 'bessel-pc-medium';
  return 'bessel-pc-low';
}

/** A copyable plain-text rendering of the Pc readouts, mirroring the displayed values/labels. */
function pcToText(result: ConjunctionEventResult): string {
  const full = result.pcFull === null ? 'n/a (no covariance in this catalog)' : result.pcFull.toExponential(3);
  return [
    `${result.primaryId} vs ${result.secondaryId}: miss ${fmt(result.missKm, 3)} km, rel speed ${fmt(result.relSpeedKmS, 3)} km/s, combined radius ${fmt(result.radiusKm * 1000, 1)} m.`,
    `Full-covariance Pc: ${full}`,
    `Max Pc (Alfano bound): ${result.pcMax.toExponential(3)}`,
  ].join('\n');
}

/** Sort the events by the selected key (descending Pc / ascending miss / ascending TCA), pure. */
function sortEvents(events: readonly ConjunctionEvent[], key: SortKey): ConjunctionEvent[] {
  const copy = [...events];
  copy.sort((a, b) => {
    if (key === 'pc') return (b.pc ?? -1) - (a.pc ?? -1);
    if (key === 'missKm') return a.missKm - b.missKm;
    return a.tca - b.tca;
  });
  return copy;
}

export function PcCard(props: { readonly engine: BesselEngine | null; readonly store: AppStore }): JSX.Element {
  const { engine, store } = props;
  const screening = useStore(store, (s) => s.screening);
  const eventResult = useStore(store, (s) => s.conjunctionEvent);
  const ingest = useStore(store, (s) => s.conjunctionIngest);
  const runStatus = useStore(store, (s) => s.runStatus);
  // [ux-p2-conjunction] First-class active selection: the table rows, the Pc result, the B-plane,
  // and the covariance-input form all read THIS selected event id.
  const selectedId = useStore(store, (s) => s.selectedConjunctionEventId);
  const trayFull = useTrayFull(store);
  const [sortKey, setSortKey] = useState<SortKey>('pc');

  const events = screening.events ?? [];
  const epoch = screening.epoch;
  const sorted = useMemo(() => sortEvents(events, sortKey), [events, sortKey]);
  // Map a sorted-row back to its index in the original events array (the engine op selects by
  // the original index, which is what the screening slice stores).
  const indexOf = (ev: ConjunctionEvent): number => events.indexOf(ev);

  const pcError = typeof runStatus['compute-event-pc'] === 'object' ? runStatus['compute-event-pc'].error : null;

  if (!ingest) {
    return (
      <p className="bessel-loader-hint" data-testid="pc-card-empty">
        Ingest a catalog and run a screen, then click an event to compute its full-covariance Pc.
      </p>
    );
  }

  return (
    <div className="bessel-pc-card" data-testid="pc-card">
      {events.length === 0 ? (
        <p className="bessel-loader-hint" data-testid="pc-no-events">
          No screened events yet. Run the screen on the ingested catalog above.
        </p>
      ) : (
        <table className="bessel-event-table" data-testid="event-table">
          <thead>
            <tr>
              <th>
                <button type="button" data-testid="sort-tca" onClick={() => setSortKey('tca')}>
                  TCA (min){sortKey === 'tca' ? ' ▼' : ''}
                </button>
              </th>
              <th>Pair</th>
              <th>
                <button type="button" data-testid="sort-miss" onClick={() => setSortKey('missKm')}>
                  Miss (km){sortKey === 'missKm' ? ' ▲' : ''}
                </button>
              </th>
              <th>
                <button type="button" data-testid="sort-pc" onClick={() => setSortKey('pc')}>
                  Pc (2D){sortKey === 'pc' ? ' ▼' : ''}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ev) => {
              const i = indexOf(ev);
              const active = selectedId === i;
              return (
                <tr
                  key={`${ev.primaryId}-${ev.secondaryId}-${i}`}
                  className={active ? 'bessel-event-row-active' : ''}
                  data-testid={`conjunction-event-${i}`}
                  data-active={active ? 'true' : 'false'}
                  aria-selected={active}
                  tabIndex={0}
                  onClick={() => void engine?.computeEventPc(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void engine?.computeEventPc(i);
                    }
                  }}
                >
                  <td>{fmt((ev.tca - epoch) / 60, 1)}</td>
                  <td>
                    {ev.primaryId} vs {ev.secondaryId}
                  </td>
                  <td>{fmt(ev.missKm, 3)}</td>
                  <td className={pcClass(ev.pc)}>{ev.pc === null ? '-' : ev.pc.toExponential(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pcError ? (
        <p className="bessel-analysis-error" data-testid="pc-error">
          Per-event Pc failed: {pcError}
        </p>
      ) : null}

      {eventResult ? (
        <div className="bessel-pc-result" data-testid="pc-result">
          <p className="bessel-analysis-stat">
            {eventResult.primaryId} vs {eventResult.secondaryId}: miss {fmt(eventResult.missKm, 3)} km, rel speed{' '}
            {fmt(eventResult.relSpeedKmS, 3)} km/s, combined radius {fmt(eventResult.radiusKm * 1000, 1)} m.
          </p>
          <p className="bessel-analysis-stat" data-testid="pc-full">
            Full-covariance Pc:{' '}
            {eventResult.pcFull === null ? 'n/a (no covariance in this catalog)' : eventResult.pcFull.toExponential(3)}
          </p>
          <p className="bessel-analysis-stat" data-testid="pc-max">
            Max Pc (Alfano bound): {eventResult.pcMax.toExponential(3)}
          </p>
          <Button
            variant="ghost"
            testId="pc-copy"
            ariaLabel="Copy collision probability"
            onClick={() => void navigator.clipboard?.writeText(pcToText(eventResult))}
          >
            Copy
          </Button>
          <BPlaneView event={eventResult} />

          {/* Explicit covariance input: shown when the selected pair carried no covariance (OEM/TLE),
              so the analyst can supply an assumed one and get a full-covariance Pc. */}
          {eventResult.hasCovariance ? null : (
            <CovarianceInputForm
              engine={engine}
              store={store}
              primaryId={eventResult.primaryId}
              secondaryId={eventResult.secondaryId}
            />
          )}

          {/* Export the selected event as a CCSDS-CDM-style record through the unified export path. */}
          <Button variant="secondary" testId="export-cdm" onClick={() => void engine?.exportEventCdm()}>
            Export CDM
          </Button>

          {/* [ux-p2-wave2b] Carrier: seed an impulsive avoidance Maneuver in the editable MCS from this
              event, then switch to the Orbit & Maneuver tab. [ux-p3-conjunction] closes the loop below. */}
          <Button
            variant="ghost"
            testId="plan-avoidance-burn"
            onClick={() => void engine?.planAvoidanceBurn()}
          >
            Plan avoidance burn
          </Button>

          {/* [ux-p3-conjunction] Close the maneuver-then-rescreen loop + the Watch affordance: screen the
              solved-maneuver primary against the catalog and show the BEFORE vs AFTER Pc for this pair. */}
          <RescreenCard
            engine={engine}
            store={store}
            primaryId={eventResult.primaryId}
            secondaryId={eventResult.secondaryId}
          />

          {/* Keep this per-event Pc result as a compare snapshot (Wave 2B generalized snapshots). */}
          <Keep
            domain="conjunction-event"
            disabled={trayFull}
            onKeep={() => engine?.keepSnapshot('conjunction-event')}
          />
        </div>
      ) : null}
    </div>
  );
}
