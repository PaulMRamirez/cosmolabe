// The Lambert porkchop contour (analysis-UX Phase 2, design section 3 tab 1): a lightweight SVG
// heatmap of total departure delta-v over the (departure epoch x time-of-flight) grid, with the
// departure axis horizontal and the TOF axis vertical, the minimum-delta-v node marked, and a
// color legend. No heavy chart library: each grid node is one rect colored on the delta-v scale.
// Presentational; reads the PorkchopResult the maneuver-design op publishes.

import type { PorkchopResult } from '../engine/porkchop.ts';

export interface PorkchopPlotProps {
  readonly result: PorkchopResult;
}

const W = 320;
const H = 220;
const PAD = 36;

/** A blue->red ramp over [0,1]: low delta-v cool, high delta-v warm (a porkchop convention). */
function heatColor(t: number): string {
  const c = Math.min(1, Math.max(0, t));
  const r = Math.round(40 + 200 * c);
  const g = Math.round(80 + 60 * (1 - Math.abs(c - 0.5) * 2));
  const b = Math.round(220 - 200 * c);
  return `rgb(${r},${g},${b})`;
}

export function PorkchopPlot(props: PorkchopPlotProps): JSX.Element {
  const { result } = props;
  const nd = result.departureEt.length;
  const nt = result.tofSec.length;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const cellW = plotW / nd;
  const cellH = plotH / nt;
  const span = Math.max(1e-9, result.maxDeltaVKmS - result.minDeltaVKmS);

  // Map a TOF index to a y so larger TOF is higher on the plot (smaller y).
  const cellY = (tofIndex: number): number => PAD + plotH - (tofIndex + 1) * cellH;
  const cellX = (departureIndex: number): number => PAD + departureIndex * cellW;

  const best = result.best;
  const departureDays = (et: number): number => (et - result.departureEt[0]!) / 86400;

  return (
    <svg
      className="bessel-porkchop"
      data-testid="porkchop"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={result.label}
    >
      <rect x={0} y={0} width={W} height={H} fill="var(--bessel-panel-bg, #11141a)" />
      {result.nodes.map((n) => {
        const v = n.deltaVKmS;
        const fill = v === null ? '#222' : heatColor((v - result.minDeltaVKmS) / span);
        return (
          <rect
            key={`${n.departureIndex}-${n.tofIndex}`}
            x={cellX(n.departureIndex)}
            y={cellY(n.tofIndex)}
            width={cellW + 0.5}
            height={cellH + 0.5}
            fill={fill}
          />
        );
      })}
      {best ? (
        <circle
          data-testid="porkchop-min"
          cx={cellX(best.departureIndex) + cellW / 2}
          cy={cellY(best.tofIndex) + cellH / 2}
          r={Math.min(cellW, cellH) / 2 + 1}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
        >
          <title>
            {`min delta-v ${best.deltaVKmS.toFixed(4)} km/s at +${departureDays(best.departureEt).toFixed(1)} d departure, TOF ${(best.tofSec / 86400).toFixed(1)} d`}
          </title>
        </circle>
      ) : null}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#888" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#888" strokeWidth={1} />
      <text x={W / 2} y={H - 8} fill="#bbb" fontSize={10} textAnchor="middle">
        departure (days from epoch)
      </text>
      <text x={12} y={H / 2} fill="#bbb" fontSize={10} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
        time of flight (days)
      </text>
    </svg>
  );
}
