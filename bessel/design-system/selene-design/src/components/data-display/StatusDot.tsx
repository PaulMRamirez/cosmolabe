import type { CSSProperties } from 'react';

export type StatusTone =
  | 'nominal'
  | 'caution'
  | 'fault'
  | 'critical'
  | 'rover'
  | 'eva'
  | 'hopper'
  | 'orbiter';

export type DotShape = 'round' | 'square' | 'diamond';

const COLOR: Record<StatusTone, string> = {
  nominal: 'var(--green)',
  caution: 'var(--amber)',
  fault: 'var(--red)',
  critical: 'var(--red-hot)',
  rover: 'var(--asset-rover)',
  eva: 'var(--asset-eva)',
  hopper: 'var(--asset-hopper)',
  orbiter: 'var(--asset-orbiter)',
};

const HALO: Partial<Record<StatusTone, string>> = {
  nominal: 'var(--halo-nominal)',
  caution: 'var(--halo-caution)',
  critical: 'var(--halo-critical)',
  fault: 'var(--halo-critical)',
};

export interface StatusDotProps {
  /** Status or asset-class — drives color. */
  tone?: StatusTone;
  /** Render a soft halo ring (use for live/critical states). */
  halo?: boolean;
  /** Diameter in px. Default 8. */
  size?: number;
  /** round (default), square (rover), or diamond (hopper). */
  shape?: DotShape;
  style?: CSSProperties;
}

/**
 * StatusDot — a colored state indicator with an optional halo ring. The system's
 * smallest state signal; also the glyph that prefixes asset rows.
 */
export function StatusDot({ tone = 'nominal', halo = false, size = 8, shape = 'round', style }: StatusDotProps) {
  const color = COLOR[tone];
  const haloRing = HALO[tone];
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background: color,
        borderRadius: shape === 'square' ? 1 : shape === 'diamond' ? 0 : '50%',
        transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
        boxShadow: halo && haloRing ? haloRing : 'none',
        display: 'inline-block',
        ...style,
      }}
    />
  );
}
