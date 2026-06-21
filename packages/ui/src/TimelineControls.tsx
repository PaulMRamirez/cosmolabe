// Timeline controls: play and pause, rate, epoch readout, a scrub slider, and
// event-marker annotations over the scrub track. Keyboard operable (native button,
// input, and per-marker button semantics).

import { markerFraction, type TimelineAnnotation } from '@bessel/timeline';

/** The time system the displayed epoch is expressed in. */
export type TimeSystem = 'UTC' | 'TDB';

export interface TimelineControlsProps {
  readonly playing: boolean;
  readonly rate: number;
  readonly epochLabel: string;
  /** Time system the epoch label is in; shown as a suffix and toggled by the buttons. */
  readonly timeSystem: TimeSystem;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly annotations?: readonly TimelineAnnotation[];
  readonly onPlayToggle: () => void;
  readonly onRateChange: (rate: number) => void;
  readonly onScrub: (et: number) => void;
  readonly onTimeSystemChange: (system: TimeSystem) => void;
  readonly onAnnotationSelect?: (et: number) => void;
}

const RATES = [1, 60, 3600, 86400, 604800];
const TIME_SYSTEMS: readonly TimeSystem[] = ['UTC', 'TDB'];

export function TimelineControls(props: TimelineControlsProps): JSX.Element {
  const annotations = props.annotations ?? [];
  return (
    <div className="bessel-timeline" role="group" aria-label="Timeline controls">
      <button type="button" onClick={props.onPlayToggle} aria-pressed={props.playing}>
        {props.playing ? 'Pause' : 'Play'}
      </button>
      <label>
        Rate
        <select
          value={props.rate}
          onChange={(e) => props.onRateChange(Number(e.target.value))}
          aria-label="Playback rate, seconds of mission time per second"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      </label>
      <div className="bessel-scrub-track">
        <input
          type="range"
          min={props.min}
          max={props.max}
          value={props.value}
          step={(props.max - props.min) / 1000 || 1}
          onChange={(e) => props.onScrub(Number(e.target.value))}
          aria-label="Scrub mission time"
          data-testid="scrub"
        />
        {annotations.length > 0 && (
          <div className="bessel-markers" aria-label="Timeline events">
            {annotations.map((a) => (
              <button
                key={a.id}
                type="button"
                className="bessel-marker"
                style={{ left: `${markerFraction(a.et, props.min, props.max) * 100}%` }}
                title={a.label}
                aria-label={`Event: ${a.label}`}
                data-testid={`marker-${a.id}`}
                onClick={() => props.onAnnotationSelect?.(a.et)}
              />
            ))}
          </div>
        )}
      </div>
      <span data-testid="epoch" className="bessel-epoch">
        {props.epochLabel}
        {props.epochLabel ? ` ${props.timeSystem}` : ''}
      </span>
      <div
        className="bessel-time-system"
        role="group"
        aria-label="Epoch time system"
        data-testid="time-system"
      >
        {TIME_SYSTEMS.map((sys) => (
          <button
            key={sys}
            type="button"
            onClick={() => props.onTimeSystemChange(sys)}
            aria-pressed={props.timeSystem === sys}
            data-testid={`time-system-${sys.toLowerCase()}`}
          >
            {sys}
          </button>
        ))}
      </div>
    </div>
  );
}
