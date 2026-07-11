import type { CSSProperties, ReactNode } from 'react';

export interface MetricProps {
  /** Short uppercase caption, e.g. "Surface slope". */
  label: string;
  /** Value — usually a mono numeric string with unit, e.g. "14°", "-198°C". */
  value: ReactNode;
  /** Value color. Default var(--ink-0); use a status color to flag out-of-range. */
  color?: string;
  style?: CSSProperties;
}

/**
 * Metric — a label/value stat pair. Label is a mono micro-caption; value is mono
 * tabular. The workhorse for dense readouts (depth, slope, temp, ETA).
 */
export function Metric({ label, value, color = 'var(--ink-0)', style }: MetricProps) {
  return (
    <div style={style}>
      <div
        className="so-mono"
        style={{
          fontSize: 'var(--text-2xs)',
          color: 'var(--ink-3)',
          letterSpacing: 'var(--track-tag)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div className="so-mono so-num" style={{ fontSize: 'var(--text-base)', color, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
