import type { CSSProperties, ReactNode } from 'react';

export interface SectionLabelProps {
  /** Section name — rendered uppercase mono. */
  children: ReactNode;
  /** Optional right-aligned meta, e.g. "8 / 12", "live", a count. */
  right?: ReactNode;
  style?: CSSProperties;
}

/**
 * SectionLabel — an uppercase mono section header with an optional right-aligned
 * count/meta. Delimits every panel region in the system.
 */
export function SectionLabel({ children, right, style }: SectionLabelProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '12px 14px 6px',
        ...style,
      }}
    >
      <span
        className="so-mono"
        style={{
          fontSize: 'var(--text-2xs)',
          color: 'var(--ink-2)',
          letterSpacing: 'var(--track-label)',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        {children}
      </span>
      {right != null && (
        <span className="so-mono so-num" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>
          {right}
        </span>
      )}
    </div>
  );
}
