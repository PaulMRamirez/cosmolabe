import type { CSSProperties } from 'react';

export interface DividerProps {
  style?: CSSProperties;
}

/** Divider — a single-pixel hairline separator between panel regions. */
export function Divider({ style }: DividerProps) {
  return <div style={{ height: 1, background: 'var(--line-soft)', ...style }} />;
}
