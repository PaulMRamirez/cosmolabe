// [ux-p3-conjunction] The conjunction WATCHLIST card: the persistent list of flagged pairs the
// analyst is tracking. Each row shows the pair, its current Pc + miss, and a rose/fell trend chip
// that updates when a re-screen runs (the maneuver-then-rescreen loop) or when an OD covariance is
// applied to the pair's per-event Pc. Presentational; the watch/unwatch/update mutations live in the
// engine ops (pure reduceWatchlist). The "Watch" affordance for the selected event lives in PcCard.

import { Button, Tag } from '@bessel/selene-design';
import type { BesselEngine } from '../../engine/index.ts';
import { useStore, type AppStore } from '../../store/index.ts';
import { fmt } from '../analysis-shared.tsx';
import type { WatchTrend } from '../../conjunction/watchlist.ts';

/** A trend -> tone/label for the row's risk-direction chip. */
function trendTag(trend: WatchTrend): { tone: 'red' | 'green' | 'neutral'; label: string } {
  if (trend === 'rose') return { tone: 'red', label: 'risk rose' };
  if (trend === 'fell') return { tone: 'green', label: 'risk fell' };
  if (trend === 'new') return { tone: 'neutral', label: 'tracking' };
  return { tone: 'neutral', label: 'unchanged' };
}

export function WatchlistCard(props: {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}): JSX.Element {
  const { engine, store } = props;
  const watchlist = useStore(store, (s) => s.watchlist);

  if (watchlist.rows.length === 0) {
    return (
      <p className="bessel-loader-hint" data-testid="watchlist-empty">
        No watched events yet. Select a screened event above and choose "Watch" to track its Pc here.
      </p>
    );
  }

  return (
    <div className="bessel-watchlist" data-testid="watchlist">
      <table className="bessel-event-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Pc</th>
            <th>Miss (km)</th>
            <th>Trend</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {watchlist.rows.map((row) => {
            const tag = trendTag(row.trend);
            return (
              <tr key={row.key} data-testid="watchlist-row" data-trend={row.trend}>
                <td>
                  {row.primaryId} vs {row.secondaryId}
                </td>
                <td>{row.pc === null ? '-' : row.pc.toExponential(2)}</td>
                <td>{fmt(row.missKm, 3)}</td>
                <td>
                  <Tag tone={tag.tone}>{tag.label}</Tag>
                </td>
                <td>
                  <Button
                    variant="ghost"
                    testId={`unwatch-${row.key}`}
                    onClick={() => void engine?.unwatchEvent(row.key)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
