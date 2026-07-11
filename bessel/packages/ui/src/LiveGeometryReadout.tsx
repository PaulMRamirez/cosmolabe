// A compact, always-visible geometry strip (Range / Altitude / Phase) bound to the
// tracked or focused object. Presentational: it reads the same Readouts the engine
// already publishes, so it stays live through a pass even when the selection (and its
// inspector card) is cleared. Distinct testids keep it separate from ReadoutPanel.

import type { Readouts } from './ReadoutPanel.tsx';

export interface LiveGeometryReadoutProps {
  readonly target: string;
  readonly readouts: Readouts;
  /** When provided, a dismiss control hides the strip (the user restores it from
   *  the visualization settings). Independent of the tracking/focus camera state. */
  readonly onDismiss?: () => void;
}

function km(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  return `${Math.round(v).toLocaleString('en-US')} km`;
}

function deg(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(1)} deg`;
}

export function LiveGeometryReadout(props: LiveGeometryReadoutProps): JSX.Element {
  const { readouts: r, target } = props;
  return (
    <div
      className="bessel-live-readout"
      role="group"
      aria-label={`Live geometry for ${target}`}
      data-testid="live-readout"
    >
      <span className="bessel-live-readout-target">{target}</span>
      <span data-testid="live-readout-range">
        <span aria-hidden="true">R </span>
        {km(r.rangeKm)}
      </span>
      <span data-testid="live-readout-altitude">
        <span aria-hidden="true">Alt </span>
        {km(r.altitudeKm)}
      </span>
      <span data-testid="live-readout-phase">
        <span aria-hidden="true">Phase </span>
        {deg(r.phaseDeg)}
      </span>
      {props.onDismiss ? (
        <button
          type="button"
          className="bessel-close-button bessel-live-readout-dismiss"
          onClick={props.onDismiss}
          aria-label="Hide live geometry readout"
          title="Hide live geometry readout"
          data-testid="live-readout-dismiss"
        >
          {'✕'}
        </button>
      ) : null}
    </div>
  );
}
