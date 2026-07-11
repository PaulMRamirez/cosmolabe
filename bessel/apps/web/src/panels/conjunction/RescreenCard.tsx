// [ux-p3-conjunction] The maneuver-then-rescreen control + BEFORE/AFTER Pc readout, shown on the
// selected per-event result. After the analyst plans an avoidance burn (the Phase-2 carrier) and
// runs the MCS corrector, "Screen after maneuver" applies the solved burn to the primary, re-screens
// it against the catalog, and shows the event's Pc + miss BEFORE vs AFTER (the risk reduction). Plus
// the "Watch" affordance that adds the selected event's pair to the watchlist. Presentational; the
// rescreen + watch mutations run in the engine ops behind the lazy seam.

import type { BesselEngine } from '../../engine/index.ts';
import { useStore, type AppStore } from '../../store/index.ts';
import { Action, fmt } from '../analysis-shared.tsx';
import { RunStatusNote } from '../RunStatus.tsx';
import { isWatched } from '../../conjunction/watchlist.ts';

/** Format a Pc for the readout: exponential, or "n/a" when the screen carried no Pc. */
function pcText(pc: number | null): string {
  return pc === null ? 'n/a' : pc.toExponential(2);
}

export function RescreenCard(props: {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly primaryId: string;
  readonly secondaryId: string;
}): JSX.Element {
  const { engine, store, primaryId, secondaryId } = props;
  const runStatus = useStore(store, (s) => s.runStatus);
  const rescreen = useStore(store, (s) => s.rescreen);
  const watchlist = useStore(store, (s) => s.watchlist);
  const watched = isWatched(watchlist, primaryId, secondaryId);
  // The comparison is for THIS pair only (order-independent).
  const forThisPair =
    rescreen &&
    ((rescreen.primaryId === primaryId && rescreen.secondaryId === secondaryId) ||
      (rescreen.primaryId === secondaryId && rescreen.secondaryId === primaryId));

  return (
    <div className="bessel-rescreen" data-testid="rescreen-card">
      <Action
        status={runStatus['rescreen-after-maneuver']}
        onClick={() => void engine?.rescreenAfterManeuver()}
        testId="rescreen-after-maneuver"
      >
        Screen after maneuver
      </Action>
      <RunStatusNote status={runStatus['rescreen-after-maneuver']} id="rescreen-after-maneuver" />

      {forThisPair ? (
        <p
          className="bessel-analysis-stat"
          data-testid="pc-before-after"
          data-reduced={rescreen.reduced ? 'true' : 'false'}
        >
          Pc before {pcText(rescreen.beforePc)} (miss {fmt(rescreen.beforeMissKm, 3)} km) -&gt; after{' '}
          {pcText(rescreen.afterPc)} (miss{' '}
          {rescreen.afterMissKm === null ? 'cleared' : `${fmt(rescreen.afterMissKm, 3)} km`}):{' '}
          {rescreen.reduced ? 'risk reduced' : 'risk not reduced'}.
        </p>
      ) : null}

      <Action
        status={runStatus['watch-event']}
        disabled={watched}
        onClick={() => void engine?.watchSelectedEvent()}
        testId="watch-event"
      >
        {watched ? 'Watching' : 'Watch'}
      </Action>
      <RunStatusNote status={runStatus['watch-event']} id="watch-event" />
    </div>
  );
}
