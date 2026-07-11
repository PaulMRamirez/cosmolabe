import type { CSSProperties } from 'react';

export interface MiniBarProps {
  /** Fraction 0..1. Clamped. */
  value: number;
  /** Fill color — encode meaning: green healthy, amber low, red critical, cyan data. */
  color?: string;
  /** Bar height in px. Default 3. */
  height?: number;
  /** Track (unfilled) color. Default var(--bg-3). */
  track?: string;
  style?: CSSProperties;
}

/**
 * MiniBar — a thin horizontal fraction bar. The atomic data-viz unit of the
 * system (battery SOC, ice probability, traverse budgets).
 */
export function MiniBar({
  value,
  color = 'var(--cyan)',
  height = 3,
  track = 'var(--bg-3)',
  style,
}: MiniBarProps) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      style={{
        width: '100%',
        height,
        background: track,
        borderRadius: 'var(--radius-xs)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ width: `${v * 100}%`, height: '100%', background: color }} />
    </div>
  );
}
