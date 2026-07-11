// A small SVG progress ring for job tray chips (M-0008): stroke-dashoffset
// over a circle, percent-driven, with an idle/complete quiet state. Promoted
// from the app when the panel became its second consumer (Session 7).

export interface ProgressRingProps {
  /** Percent complete in [0, 100]. */
  readonly pct: number;
  readonly active: boolean;
  readonly size?: number;
}

export function ProgressRing({ pct, active, size = 18 }: ProgressRingProps): JSX.Element {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`progress ${Math.round(clamped)} percent`}
      data-testid="progress-ring"
      data-pct={Math.round(clamped)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#8884"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={active ? '#67e8f9' : '#3fb950'}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
