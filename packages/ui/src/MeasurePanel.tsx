// Measurement panel: shows the straight-line distance between the first two
// selected objects. Presentational; the engine computes the distance from
// ephemerides and the viewer passes it through.

const AU_KM = 1.495978707e8;

export interface MeasurePanelProps {
  readonly from: string | null;
  readonly to: string | null;
  readonly distanceKm: number | null;
}

function formatDistance(km: number): string {
  const base = `${Math.round(km).toLocaleString('en-US')} km`;
  if (km >= 1e7) return `${base} (${(km / AU_KM).toFixed(3)} AU)`;
  return base;
}

export function MeasurePanel(props: MeasurePanelProps): JSX.Element {
  if (props.from === null || props.to === null || props.distanceKm === null) {
    return (
      <div className="bessel-measure" data-testid="measure-panel">
        <p className="bessel-measure-empty">Select two objects to measure</p>
      </div>
    );
  }
  return (
    <div className="bessel-measure" data-testid="measure-panel">
      <div className="bessel-measure-pair">
        {props.from} to {props.to}
      </div>
      <div className="bessel-measure-value" data-testid="measure-distance">
        {formatDistance(props.distanceKm)}
      </div>
    </div>
  );
}
