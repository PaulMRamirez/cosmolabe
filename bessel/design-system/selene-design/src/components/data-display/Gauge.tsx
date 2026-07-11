import type { CSSProperties } from 'react';
import { MiniBar } from './MiniBar';

export interface GaugeProps {
  /** Uppercase caption, e.g. "Comms". */
  label: string;
  /** Fraction 0..1 — rendered as a whole-number percent. */
  value: number;
  /** Accent color for the number + bar. */
  color?: string;
  style?: CSSProperties;
}

/**
 * Gauge — a boxed percentage readout with a big mono number and a MiniBar.
 * Used for traverse budgets and at-a-glance fractions inside cards.
 */
export function Gauge({ label, value, color = 'var(--cyan)', style }: GaugeProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-0)',
        border: '0.5px solid var(--line-soft)',
        ...style,
      }}
    >
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
      <div
        className="so-mono so-num"
        style={{ fontSize: 18, color, fontWeight: 600, marginTop: 4, lineHeight: 1 }}
      >
        {pct}
        <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 2 }}>%</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <MiniBar value={value} color={color} />
      </div>
    </div>
  );
}
