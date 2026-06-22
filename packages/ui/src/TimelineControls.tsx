// Timeline controls: play and pause, rate, epoch readout, a scrub slider, and
// event-marker annotations over the scrub track. Keyboard operable (native button,
// input, and per-marker button semantics).

import { useState } from 'react';
import { Icon, type IconName } from '@bessel/selene-design';
import { markerFraction, type TimelineAnnotation } from '@bessel/timeline';

/** The time system the displayed epoch is expressed in. */
export type TimeSystem = 'UTC' | 'TDB';

/** Plain-language gloss for a playback rate (mission seconds per wall-clock second). */
export function humanizeRate(secPerSec: number): string {
  const units: readonly (readonly [number, string])[] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'min'],
    [1, 'sec'],
  ];
  for (const [size, name] of units) {
    if (secPerSec >= size) {
      const n = secPerSec / size;
      const q = Number.isInteger(n) ? String(n) : n.toFixed(1);
      return `${q} ${name}${n === 1 ? '' : 's'}/sec`;
    }
  }
  return `${secPerSec}x`;
}

export interface TimelineControlsProps {
  readonly playing: boolean;
  readonly rate: number;
  readonly epochLabel: string;
  /** Time system the epoch label is in; shown as a suffix and toggled by the buttons. */
  readonly timeSystem: TimeSystem;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  /** Formatted window start/end, shown at the scrub track ends, or null when unknown. */
  readonly minLabel?: string | null;
  readonly maxLabel?: string | null;
  readonly annotations?: readonly TimelineAnnotation[];
  /** The next upcoming event label + its T-minus (derived by the viewer), or null. */
  readonly nextEventLabel?: string | null;
  readonly nextEventTMinus?: string | null;
  readonly onPlayToggle: () => void;
  readonly onRateChange: (rate: number) => void;
  readonly onScrub: (et: number) => void;
  readonly onTimeSystemChange: (system: TimeSystem) => void;
  /** Jump the clock to a typed epoch (parsed/validated by the engine). */
  readonly onGoToEpoch?: (text: string) => void;
  /** A loud parse error for the go-to-epoch field, or null. */
  readonly goToEpochError?: string | null;
  readonly onAnnotationSelect?: (et: number) => void;
}

const RATES = [1, 60, 3600, 86400, 604800];
const TIME_SYSTEMS: readonly TimeSystem[] = ['UTC', 'TDB'];

/** One step/jump transport button (the controls flanking play/pause). */
interface StepControl {
  readonly icon: IconName;
  readonly label: string;
  readonly testId: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function renderStep(s: StepControl): JSX.Element {
  return (
    <button
      key={s.testId}
      type="button"
      className="bessel-transport-step"
      aria-label={s.label}
      data-testid={s.testId}
      disabled={s.disabled}
      onClick={s.onClick}
    >
      <Icon name={s.icon} />
    </button>
  );
}

export function TimelineControls(props: TimelineControlsProps): JSX.Element {
  const annotations = props.annotations ?? [];
  const [goto, setGoto] = useState('');
  const submitGoto = (): void => {
    const t = goto.trim();
    if (t) props.onGoToEpoch?.(t);
  };
  // A step is 1% of the loaded window, so step/jump navigate without reaching for the
  // slider; seeks clamp to the window bounds.
  const step = (props.max - props.min) / 100 || 1;
  const seek = (t: number): void => props.onScrub(Math.min(props.max, Math.max(props.min, t)));
  const atStart = props.value <= props.min;
  const atEnd = props.value >= props.max;
  // The step/jump controls flanking play/pause: same shape, so render from a table.
  const steps: readonly StepControl[] = [
    { icon: 'step-back', label: 'Jump to mission start', testId: 'timeline-to-start', disabled: atStart, onClick: () => props.onScrub(props.min) },
    { icon: 'chevron-left', label: 'Step back', testId: 'timeline-step-back', disabled: atStart, onClick: () => seek(props.value - step) },
    { icon: 'chevron-right', label: 'Step forward', testId: 'timeline-step-forward', disabled: atEnd, onClick: () => seek(props.value + step) },
    { icon: 'step-forward', label: 'Jump to mission end', testId: 'timeline-to-end', disabled: atEnd, onClick: () => props.onScrub(props.max) },
  ];
  return (
    <div className="bessel-timeline" role="group" aria-label="Timeline controls">
      <div className="bessel-transport" role="group" aria-label="Playback transport">
        {steps.slice(0, 2).map(renderStep)}
        <button
          type="button"
          className="bessel-transport-step"
          onClick={props.onPlayToggle}
          aria-pressed={props.playing}
          aria-label={props.playing ? 'Pause' : 'Play'}
          data-testid="timeline-play"
        >
          <Icon name={props.playing ? 'pause' : 'play'} />
        </button>
        {steps.slice(2).map(renderStep)}
      </div>
      <label>
        Rate
        <select
          value={props.rate}
          onChange={(e) => props.onRateChange(Number(e.target.value))}
          aria-label="Playback rate, seconds of mission time per second"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}x (~ {humanizeRate(r)})
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
            {annotations.map((a) => {
              const left = `${markerFraction(a.et, props.min, props.max) * 100}%`;
              return (
                <span key={a.id} className="bessel-marker-group">
                  <button
                    type="button"
                    className="bessel-marker"
                    style={{ left }}
                    title={a.label}
                    aria-label={`Event: ${a.label}`}
                    data-testid={`marker-${a.id}`}
                    onClick={() => props.onAnnotationSelect?.(a.et)}
                  />
                  <span className="bessel-marker-label" style={{ left }} aria-hidden="true">
                    {a.label}
                  </span>
                </span>
              );
            })}
          </div>
        )}
        {props.minLabel || props.maxLabel ? (
          <div className="bessel-scrub-bounds" aria-hidden="true" data-testid="scrub-bounds">
            <span>{props.minLabel}</span>
            <span>{props.maxLabel}</span>
          </div>
        ) : null}
      </div>
      <span className="bessel-epoch-group">
        <span data-testid="epoch" className="bessel-epoch">
          {props.epochLabel}
        </span>
        <label className="bessel-time-system">
          <span className="bessel-visually-hidden">Epoch time system</span>
          <select
            value={props.timeSystem}
            onChange={(e) => props.onTimeSystemChange(e.target.value as TimeSystem)}
            data-testid="time-system"
            aria-label="Epoch time system"
          >
            {TIME_SYSTEMS.map((sys) => (
              <option key={sys} value={sys}>
                {sys}
              </option>
            ))}
          </select>
        </label>
      </span>
      <input
        type="text"
        className="bessel-goto-epoch"
        value={goto}
        placeholder={`Go to (${props.timeSystem})`}
        aria-label={`Go to epoch (${props.timeSystem})`}
        data-testid="goto-epoch"
        onChange={(e) => setGoto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitGoto();
        }}
        onBlur={submitGoto}
      />
      {props.goToEpochError ? (
        <span role="alert" className="bessel-timeline-error" data-testid="goto-epoch-error">
          {props.goToEpochError}
        </span>
      ) : null}
      <span className="bessel-next-event" data-testid="next-event">
        {props.nextEventLabel
          ? `Next: ${props.nextEventLabel} T-${props.nextEventTMinus ?? ''}`
          : 'No upcoming events'}
      </span>
    </div>
  );
}
