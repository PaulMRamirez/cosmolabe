// Measurement panel: shows the straight-line distance between the first two
// selected objects. Presentational; the engine computes the distance from
// ephemerides and the viewer passes it through.

const AU_KM = 1.495978707e8;

export interface MeasurePanelProps {
  readonly from: string | null;
  readonly to: string | null;
  readonly distanceKm: number | null;
  /** Range rate, km/s: negative closing, positive separating, or null. */
  readonly relativeSpeedKmS?: number | null;
  /** Angular separation seen from the spacecraft, degrees, or null. */
  readonly angleDeg?: number | null;
  /** The observer the angle is measured from (the mission spacecraft). */
  readonly observer?: string | null;
  /** True when Measure mode is active (canvas clicks build the measured pair). */
  readonly measureMode?: boolean;
  readonly onToggleMode?: () => void;
  /** Clear the current selection; omit (or no selection) to hide the control. */
  readonly onClear?: () => void;
  /** True when at least one object is selected, gating the Clear control. */
  readonly hasSelection?: boolean;
}

function formatDistance(km: number): string {
  const base = `${Math.round(km).toLocaleString('en-US')} km`;
  if (km >= 1e7) return `${base} (${(km / AU_KM).toFixed(3)} AU)`;
  return base;
}

// Below this range rate (km/s) the pair is effectively neither closing nor
// separating; routing an exactly-zero (or sub-mm/s) rate to "separating" reads as
// a false trend, so it gets a neutral label instead.
const STEADY_EPS_KMS = 1e-6;

export function formatSpeed(kmS: number): string {
  if (Math.abs(kmS) < STEADY_EPS_KMS) return `${Math.abs(kmS).toFixed(3)} km/s steady`;
  const trend = kmS < 0 ? 'closing' : 'separating';
  return `${Math.abs(kmS).toFixed(3)} km/s ${trend}`;
}

/** The Measure-mode toggle and Clear-selection controls, shared by both states. */
function MeasureControls(props: MeasurePanelProps): JSX.Element | null {
  if (!props.onToggleMode && !props.onClear) return null;
  return (
    <div className="bessel-measure-controls" role="group" aria-label="Measure controls">
      {props.onToggleMode ? (
        <button
          type="button"
          className="bessel-measure-mode"
          aria-pressed={!!props.measureMode}
          onClick={props.onToggleMode}
          data-testid="measure-mode"
        >
          Measure mode: {props.measureMode ? 'on' : 'off'}
        </button>
      ) : null}
      {props.onClear && props.hasSelection ? (
        <button type="button" onClick={props.onClear} data-testid="measure-clear">
          Clear selection
        </button>
      ) : null}
    </div>
  );
}

export function MeasurePanel(props: MeasurePanelProps): JSX.Element {
  if (props.from === null || props.to === null || props.distanceKm === null) {
    return (
      <div className="bessel-measure" data-testid="measure-panel">
        <p className="bessel-measure-empty">
          {props.measureMode
            ? 'Measure mode: click two objects in the view'
            : 'Select two objects to measure'}
        </p>
        <MeasureControls {...props} />
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
      {props.relativeSpeedKmS !== null && props.relativeSpeedKmS !== undefined ? (
        <div className="bessel-measure-speed" data-testid="measure-speed">
          {formatSpeed(props.relativeSpeedKmS)}
        </div>
      ) : null}
      {props.angleDeg !== null && props.angleDeg !== undefined ? (
        <div className="bessel-measure-angle" data-testid="measure-angle">
          {props.angleDeg.toFixed(2)} deg apart from {props.observer ?? 'the spacecraft'}
        </div>
      ) : null}
      <MeasureControls {...props} />
    </div>
  );
}
