import type { CSSProperties, ReactNode } from 'react';

export type EventKind = 'info' | 'data' | 'warn' | 'crit';

const KIND_COLOR: Record<EventKind, string> = {
  info: 'var(--ink-2)',
  data: 'var(--cyan)',
  warn: 'var(--amber)',
  crit: 'var(--red-hot)',
};

export interface EventRowProps {
  /** Timestamp string, e.g. "14:22:08". Mono. */
  time: string;
  /** Source ID, e.g. "RV-01", "SYS". Colored by kind. */
  src: string;
  /** Severity — info (default), data (cyan), warn (amber), crit (red). */
  kind?: EventKind;
  /** Message text. */
  msg: ReactNode;
  style?: CSSProperties;
}

/**
 * EventRow — one line in a live event/log feed: timestamp, source tag, message.
 * Critical events tint the message and weight it up.
 */
export function EventRow({ time, src, kind = 'info', msg, style }: EventRowProps) {
  const c = KIND_COLOR[kind];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 50px 1fr',
        gap: 8,
        padding: '6px 0',
        borderBottom: '0.5px solid var(--line-soft)',
        alignItems: 'baseline',
        ...style,
      }}
    >
      <span className="so-mono so-num" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
        {time}
      </span>
      <span className="so-mono" style={{ fontSize: 10, color: c, letterSpacing: '0.06em' }}>
        {src}
      </span>
      <span
        style={{
          fontSize: 11.5,
          color: kind === 'crit' ? 'var(--red-hot)' : 'var(--ink-1)',
          fontWeight: kind === 'crit' ? 500 : 400,
        }}
      >
        {msg}
      </span>
    </div>
  );
}
