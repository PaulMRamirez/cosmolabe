import type { CSSProperties, ReactNode } from 'react';

export type TagTone = 'neutral' | 'amber' | 'cyan' | 'green' | 'red' | 'violet';

interface ToneStyle {
  bg: string;
  fg: string;
  bd: string;
}

const TONES: Record<TagTone, ToneStyle> = {
  neutral: { bg: 'oklch(0.27 0.011 65)', fg: 'var(--ink-1)', bd: 'var(--line)' },
  amber: { bg: 'oklch(0.80 0.15 70 / 0.12)', fg: 'var(--amber)', bd: 'oklch(0.80 0.15 70 / 0.35)' },
  cyan: { bg: 'oklch(0.78 0.11 210 / 0.10)', fg: 'var(--cyan)', bd: 'oklch(0.78 0.11 210 / 0.3)' },
  green: { bg: 'oklch(0.78 0.14 145 / 0.10)', fg: 'var(--green)', bd: 'oklch(0.78 0.14 145 / 0.3)' },
  red: { bg: 'oklch(0.68 0.19 25 / 0.12)', fg: 'var(--red-hot)', bd: 'oklch(0.72 0.22 22 / 0.4)' },
  violet: { bg: 'oklch(0.70 0.13 295 / 0.12)', fg: 'var(--violet)', bd: 'oklch(0.70 0.13 295 / 0.3)' },
};

export interface TagProps {
  /** Chip contents — keep to 1–3 short words; rendered uppercase. */
  children: ReactNode;
  /** Semantic color. nominal=green, caution=amber, fault/critical=red, data/ice=cyan, shadow=violet. */
  tone?: TagTone;
  style?: CSSProperties;
}

/**
 * Tag — a small uppercase status/metadata chip. The system's primary way to
 * surface state (confidence, asset status, hazard flags).
 */
export function Tag({ children, tone = 'neutral', style }: TagProps) {
  const t = TONES[tone];
  return (
    <span
      className="so-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        background: t.bg,
        color: t.fg,
        border: `0.5px solid ${t.bd}`,
        borderRadius: 'var(--radius-xs)',
        fontSize: 'var(--text-2xs)',
        letterSpacing: 'var(--track-tag)',
        textTransform: 'uppercase',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
