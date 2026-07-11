// A Gantt-style bar that renders analysis intervals (access, eclipse, ...) over a
// span, aligned to the playback clock. Presentational; the engine computes the
// Window. (STK_PARITY_SPEC F5 / §4.3.)

import { type Window } from '@bessel/timeline';

export interface IntervalTimelineProps {
  readonly intervals: Window;
  /** The full span [start, stop] (ET seconds) the bar represents. */
  readonly span: readonly [number, number];
  readonly label?: string;
  readonly testId?: string;
  /** Shared time cursor (ET seconds); drawn as a vertical marker when inside the span. */
  readonly cursorEt?: number;
}

export function IntervalTimeline(props: IntervalTimelineProps): JSX.Element {
  const [t0, t1] = props.span;
  const duration = t1 - t0 || 1;
  const count = props.intervals.length;
  const cursorPct =
    props.cursorEt !== undefined && props.cursorEt >= t0 && props.cursorEt <= t1
      ? ((props.cursorEt - t0) / duration) * 100
      : null;
  return (
    <div className="bessel-gantt" data-testid={props.testId ?? 'interval-timeline'}>
      <div
        className="bessel-gantt-track"
        role="img"
        aria-label={props.label ?? `${count} intervals`}
        style={{ position: 'relative' }}
      >
        {props.intervals.map(([s, e], i) => (
          <span
            key={i}
            className="bessel-gantt-bar"
            style={{
              left: `${((s - t0) / duration) * 100}%`,
              width: `${(Math.max(0, e - s) / duration) * 100}%`,
            }}
          />
        ))}
        {cursorPct !== null ? (
          <span
            className="bessel-gantt-cursor"
            data-testid={`${props.testId ?? 'interval-timeline'}-cursor`}
            data-et={props.cursorEt}
            style={{
              position: 'absolute',
              left: `${cursorPct}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: '#67e8f9',
            }}
          />
        ) : null}
      </div>
      <div className="bessel-gantt-meta" data-testid="interval-count">
        {count} interval{count === 1 ? '' : 's'}
      </div>
    </div>
  );
}
