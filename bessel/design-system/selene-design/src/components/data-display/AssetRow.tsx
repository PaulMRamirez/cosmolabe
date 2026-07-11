import type { CSSProperties } from 'react';
import { StatusDot, type DotShape } from './StatusDot';
import { MiniBar } from './MiniBar';

export type AssetKind = 'rover' | 'eva' | 'hopper' | 'orbiter';

interface KindStyle {
  color: string;
  shape: DotShape;
}

const KIND: Record<AssetKind, KindStyle> = {
  rover: { color: 'var(--asset-rover)', shape: 'square' },
  eva: { color: 'var(--asset-eva)', shape: 'round' },
  hopper: { color: 'var(--asset-hopper)', shape: 'diamond' },
  orbiter: { color: 'var(--asset-orbiter)', shape: 'round' },
};

export interface AssetRowProps {
  /** Short asset ID, e.g. "RV-01". Mono. */
  id: string;
  /** Human name, e.g. "Prospector I". */
  name: string;
  /** Role/task, e.g. "Ice prospecting". Dimmed. */
  role?: string;
  /** Asset class — sets glyph shape + color. */
  kind?: AssetKind;
  /** State-of-charge 0..1 — drives the battery bar color (green/amber/red). */
  soc?: number;
  selected?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

/**
 * AssetRow — a selectable roster row for a surface asset: class glyph, ID, name/role,
 * SOC readout + battery bar, left accent when selected. Core of the asset rail.
 */
export function AssetRow({
  id,
  name,
  role,
  kind = 'rover',
  soc = 1,
  selected = false,
  onClick,
  style,
}: AssetRowProps) {
  const k = KIND[kind];
  const socColor = soc > 0.5 ? 'var(--green)' : soc > 0.25 ? 'var(--amber)' : 'var(--red-hot)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 8px',
        width: '100%',
        borderRadius: 'var(--radius-md)',
        textAlign: 'left',
        background: selected ? 'var(--bg-3)' : 'transparent',
        borderLeft: `2px solid ${selected ? k.color : 'transparent'}`,
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        ...style,
      }}
    >
      <StatusDot tone={kind} shape={k.shape} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            className="so-mono"
            style={{ fontSize: 11, color: 'var(--ink-0)', fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            {id}
          </span>
          <span
            className="so-mono so-num"
            style={{ fontSize: 9.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
          >
            SOC {Math.round(soc * 100)}%
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ink-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
          {role && (
            <>
              {' · '}
              <span style={{ color: 'var(--ink-3)' }}>{role}</span>
            </>
          )}
        </div>
        <div style={{ marginTop: 3 }}>
          <MiniBar value={soc} color={socColor} />
        </div>
      </div>
    </button>
  );
}
