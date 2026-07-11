// A lightweight ground-track overlay: sub-spacecraft longitude/latitude samples (radians)
// projected by @bessel/map-projection and drawn as a polyline, with an optional set of
// ground-station markers draped in the same projection. No map tiles (general GIS is the MMGIS
// handoff); this is the orbital overlay. The engine supplies the lon/lat samples; the projection
// math is the shared core package (via ground-track-projection.ts) so the three selectable
// projections stay a single tested source of truth. Presentational: it takes the SELECTED
// projection + station markers as props (the projection <select> lives in the owning panel).
// (STK_PARITY_SPEC §4.12.)

import { useState } from 'react';
import {
  projectToBox,
  placeStations,
  type GroundTrackProjection,
  type GroundTrackStation,
} from './ground-track-projection.ts';

export type { GroundTrackProjection, GroundTrackStation };

export interface GroundTrackMapProps {
  /** Sub-spacecraft longitude and latitude samples, radians. */
  readonly lon: Float64Array | readonly number[];
  readonly lat: Float64Array | readonly number[];
  readonly projection?: GroundTrackProjection;
  /** Optional ground stations to mark on the map (lon/lat radians). */
  readonly stations?: readonly GroundTrackStation[];
  readonly width?: number;
  readonly height?: number;
  /** The thumbnail-to-enlarged size when the enlarge toggle is on. */
  readonly enlargedWidth?: number;
  readonly enlargedHeight?: number;
  /** Force station name labels on (otherwise they appear only in the enlarged view). */
  readonly showLabels?: boolean;
  readonly label?: string;
  readonly testId?: string;
}

export function GroundTrackMap(props: GroundTrackMapProps): JSX.Element {
  const [enlarged, setEnlarged] = useState(false);

  // The enlarge toggle (F29) swaps the thumbnail size for a larger one by feeding the existing
  // render path the larger width/height. The thumbnail defaults match the prior fixed overlay.
  const thumbW = props.width ?? 280;
  const thumbH = props.height ?? 140;
  const w = enlarged ? (props.enlargedWidth ?? 560) : thumbW;
  const h = enlarged ? (props.enlargedHeight ?? 280) : thumbH;
  const kind = props.projection ?? 'equirectangular';
  const n = Math.min(props.lon.length, props.lat.length);

  // Station name labels (F28) crowd the thumbnail, so they are gated behind the enlarged view by
  // default; showLabels forces them on for callers that want them at thumbnail size.
  const labelsOn = props.showLabels ?? enlarged;

  // Project each sample to the SVG box (north up) and split the polyline where it jumps across
  // the box (an antimeridian wrap, or the polar disk's far side) so the track does not streak. A
  // segment with a single point (one sample trapped between two wraps) is kept and drawn as a dot
  // rather than silently dropped.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let prevX = NaN;
  for (let i = 0; i < n; i++) {
    const { x, y } = projectToBox(props.lon[i]!, props.lat[i]!, kind, w, h);
    if (!Number.isNaN(prevX) && Math.abs(x - prevX) > w / 2) {
      if (current.length >= 1) segments.push(current);
      current = [];
    }
    current.push({ x, y });
    prevX = x;
  }
  if (current.length >= 1) segments.push(current);

  const stations = placeStations(props.stations ?? [], kind, w, h);

  // Compact legend (F28): a swatch for the track line and one for the station markers, parked in
  // the lower-left so it clears the title region. Sized to fit the thumbnail.
  const legendX = 6;
  const legendY = h - 22;

  return (
    <div className="bessel-groundtrack-wrap">
      <div className="bessel-groundtrack-controls">
        <button
          type="button"
          className="bessel-groundtrack-enlarge"
          data-testid="groundtrack-enlarge"
          aria-pressed={enlarged}
          onClick={() => setEnlarged((v) => !v)}
        >
          {enlarged ? 'Collapse' : 'Enlarge'}
        </button>
      </div>
      <svg
        className="bessel-groundtrack"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={props.label ?? 'Ground track'}
        data-testid={props.testId ?? 'ground-track'}
      >
        <rect className="bessel-groundtrack-bg" x={0} y={0} width={w} height={h} />
        {/* Equator and prime meridian for orientation. */}
        <line className="bessel-groundtrack-grid" x1={0} y1={h / 2} x2={w} y2={h / 2} />
        <line className="bessel-groundtrack-grid" x1={w / 2} y1={0} x2={w / 2} y2={h} />
        {segments.map((pts, i) =>
          pts.length >= 2 ? (
            <polyline
              key={i}
              className="bessel-groundtrack-line"
              fill="none"
              points={pts.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' ')}
            />
          ) : (
            <circle
              key={i}
              className="bessel-groundtrack-point"
              cx={pts[0]!.x.toFixed(2)}
              cy={pts[0]!.y.toFixed(2)}
              r={1.5}
            />
          ),
        )}
        {stations.map((s) => {
          // Place the label just right of the marker, then clamp it inside the box so a station
          // near the east/south edge does not overflow (flip to the marker's left near the right
          // edge). The <title> stays as the touch/screen-reader fallback.
          const pad = 3;
          const flip = s.x > w - 56;
          const anchor = flip ? 'end' : 'start';
          const lx = Math.min(Math.max(s.x + (flip ? -6 : 6), pad), w - pad);
          const ly = Math.min(Math.max(s.y - 5, 10), h - pad);
          return (
            <g key={s.id} data-testid="groundtrack-station-overlay">
              <circle
                className="bessel-groundtrack-station"
                cx={s.x.toFixed(2)}
                cy={s.y.toFixed(2)}
                r={3}
              >
                <title>{s.name}</title>
              </circle>
              {labelsOn ? (
                <text
                  className="bessel-groundtrack-station-label"
                  data-testid="groundtrack-station-label"
                  x={lx.toFixed(2)}
                  y={ly.toFixed(2)}
                  textAnchor={anchor}
                >
                  {s.name}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Key identifying the track line and station markers. */}
        <g className="bessel-groundtrack-legend" data-testid="groundtrack-legend">
          <line
            className="bessel-groundtrack-legend-line"
            x1={legendX}
            y1={legendY}
            x2={legendX + 14}
            y2={legendY}
          />
          <text className="bessel-groundtrack-legend-label" x={legendX + 18} y={legendY + 3}>
            Track
          </text>
          <circle
            className="bessel-groundtrack-legend-station"
            cx={legendX + 7}
            cy={legendY + 12}
            r={3}
          />
          <text className="bessel-groundtrack-legend-label" x={legendX + 18} y={legendY + 15}>
            Station
          </text>
        </g>
      </svg>
    </div>
  );
}
