// Presentational result blocks for the COVERAGE & CONSTELLATION workflow: the metric-aware
// contour LEGEND (the selected metric's name + units over the viridis color scale the overlay
// uses) and the regional FOM SUMMARY TABLE with CSV export. Both read store result shapes; no
// engine or geometry. The legend mirrors @bessel/scene's viridis ramp so the swatch matches
// the draped overlay (low = dark violet, high = yellow), with the worse/better ends labelled.

import type { CoverageMetricSelection, CoverageFomSummaryState } from '../store/index.ts';
import { fmt } from './analysis-shared.tsx';

/** The FOM summary as labelled [quantity, value] CSV rows (the scalarCsv input shape). Lives
 *  here (the lazy panel chunk) rather than importing the engine coverage-metric module, so the
 *  panel chunk does not pull the metric/ring engine helpers it never renders. */
export function coverageSummaryRows(s: CoverageFomSummaryState): (readonly [string, string | number])[] {
  return [
    ['cell_count', s.cellCount],
    ['area_weighted_coverage_pct', s.areaWeightedPercentCoverage * 100],
    ['min_coverage_pct', s.minPercentCoverage * 100],
    ['mean_coverage_pct', s.meanPercentCoverage * 100],
    ['max_coverage_pct', s.maxPercentCoverage * 100],
    ['worst_max_revisit_min', s.worstRevisitMaxSec / 60],
    ['worst_response_time_min', s.worstResponseTimeSec === null ? 'never' : s.worstResponseTimeSec / 60],
    [`nfold_k${s.nFoldK}_cell_fraction`, s.nFoldCellFraction],
  ];
}

/** The contour legend: the metric name, its units, and the viridis low-to-high color scale
 *  (the gradient is a static CSS class mirroring the @bessel/scene overlay ramp). A higher
 *  normalized scalar always reads as "better", so the ends are labelled worse/better. */
export function ContourLegend(props: { metric: CoverageMetricSelection }): JSX.Element {
  const { metric } = props;
  const unit = metric.unit ? ` (${metric.unit})` : '';
  const name = metric.id === 'nFold' ? `${metric.label} (k=${metric.nFoldK})` : metric.label;
  return (
    <div className="bessel-contour-legend" data-testid="coverage-contour-legend">
      <span className="bessel-legend-name" data-testid="coverage-legend-metric">
        {name}
        {unit}
      </span>
      <span className="bessel-legend-scale" aria-hidden="true" />
      <span className="bessel-legend-ends">
        <span>worse</span>
        <span>better</span>
      </span>
    </div>
  );
}

/** A revisit/response value (s) formatted as minutes, or "never" for a null response. */
function minutes(sec: number | null): string {
  return sec === null ? 'never' : `${fmt(sec / 60, 1)} min`;
}

/** The regional aggregate FOM SUMMARY TABLE plus a CSV export. Rows: coverage min/mean/max,
 *  the worst revisit + response time, the mean access duration, and the N-fold cell fraction. */
export function FomSummaryTable(props: {
  summary: CoverageFomSummaryState;
  onExportCsv: () => void;
}): JSX.Element {
  const s = props.summary;
  const rows: readonly (readonly [string, string])[] = [
    ['Cells', String(s.cellCount)],
    ['Area-weighted coverage', `${fmt(s.areaWeightedPercentCoverage * 100, 1)}%`],
    ['Coverage min / mean / max', `${fmt(s.minPercentCoverage * 100, 1)} / ${fmt(s.meanPercentCoverage * 100, 1)} / ${fmt(s.maxPercentCoverage * 100, 1)}%`],
    ['Worst max revisit', minutes(s.worstRevisitMaxSec)],
    ['Worst response time', minutes(s.worstResponseTimeSec)],
    [`N-fold k=${s.nFoldK} cells`, `${fmt(s.nFoldCellFraction * 100, 1)}%`],
  ];
  return (
    <div className="bessel-fom-summary" data-testid="coverage-fom-summary">
      <table className="bessel-fom-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="bessel-csv-button"
        data-testid="coverage-fom-csv"
        onClick={props.onExportCsv}
      >
        Export CSV
      </button>
    </div>
  );
}
