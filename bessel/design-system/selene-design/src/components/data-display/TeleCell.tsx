import type { CSSProperties, ReactNode } from 'react';

export interface TeleCellProps {
  /** Tiny uppercase label, e.g. "SOC", "HEADING". */
  label: string;
  /** Mono value — number or short string. */
  value: ReactNode;
  /** Optional unit shown dimmed after the value, e.g. "m/s", "°C". */
  unit?: string;
  /** Value color. Default var(--ink-0). */
  color?: string;
  style?: CSSProperties;
}

/**
 * TeleCell — a single telemetry tile: micro-label, big mono value, optional unit.
 * Grid several together for an asset's live readout block.
 */
export function TeleCell({ label, value, unit, color = 'var(--ink-0)', style }: TeleCellProps) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-0)',
        border: '0.5px solid var(--line-soft)',
        ...style,
      }}
    >
      <div className="so-mono" style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
        {label}
      </div>
      <div style={{ marginTop: 3, display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span className="so-mono so-num" style={{ fontSize: 16, color, fontWeight: 600 }}>
          {value}
        </span>
        {unit && <span className="so-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{unit}</span>}
      </div>
    </div>
  );
}
