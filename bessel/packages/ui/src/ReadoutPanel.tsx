// Geometric readout panel (range, phase angle, incidence, emission). Presentational:
// it formats and displays values supplied by the viewer (computed via @bessel/spice),
// importing no engine itself.

import { Button } from '@bessel/selene-design';

export interface Readouts {
  /** Observer to target range, km. */
  readonly rangeKm: number | null;
  /** Observer altitude above the target's surface (range minus mean radius), km. */
  readonly altitudeKm: number | null;
  /** Solar phase angle, degrees. */
  readonly phaseDeg: number | null;
  /** Solar incidence angle, degrees. */
  readonly incidenceDeg: number | null;
  /** Emission angle, degrees. */
  readonly emissionDeg: number | null;
}

export interface ReadoutPanelProps {
  readonly target: string;
  readonly readouts: Readouts;
}

function km(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value).toLocaleString('en-US')} km`;
}

function deg(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)} deg`;
}

/** A copyable plain-text rendering of the readouts, for pasting into notes or tools. */
function readoutsToText(target: string, r: Readouts): string {
  return [
    `${target} geometry`,
    `Range ${km(r.rangeKm)}`,
    `Altitude ${km(r.altitudeKm)}`,
    `Phase ${deg(r.phaseDeg)}`,
    `Incidence ${deg(r.incidenceDeg)}`,
    `Emission ${deg(r.emissionDeg)}`,
  ].join('\n');
}

export function ReadoutPanel(props: ReadoutPanelProps): JSX.Element {
  const { readouts } = props;
  return (
    <section className="bessel-readouts" aria-label={`Geometry readouts for ${props.target}`}>
      <h2 className="bessel-panel-title">Geometry: {props.target}</h2>
      <dl>
        <dt>Range</dt>
        <dd data-testid="readout-range">{km(readouts.rangeKm)}</dd>
        <dt>Altitude</dt>
        <dd data-testid="readout-altitude">{km(readouts.altitudeKm)}</dd>
        <dt>Phase</dt>
        <dd data-testid="readout-phase">{deg(readouts.phaseDeg)}</dd>
        <dt>Incidence</dt>
        <dd data-testid="readout-incidence">{deg(readouts.incidenceDeg)}</dd>
        <dt>Emission</dt>
        <dd data-testid="readout-emission">{deg(readouts.emissionDeg)}</dd>
      </dl>
      <Button
        variant="ghost"
        testId="readout-copy"
        ariaLabel="Copy readouts"
        onClick={() => void navigator.clipboard?.writeText(readoutsToText(props.target, readouts))}
      >
        Copy
      </Button>
    </section>
  );
}
