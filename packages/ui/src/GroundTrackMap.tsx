// A lightweight ground-track overlay: sub-spacecraft longitude/latitude samples
// (radians) projected by @bessel/map-projection and drawn as a polyline. No map
// tiles (general GIS is the MMGIS handoff); this is the orbital overlay. The engine
// supplies the lon/lat samples; the projection math is the shared core package, so
// equirectangular and Web Mercator stay a single source of truth. (STK §4.12.)

import {
  equirectangularForward,
  webMercatorForward,
  WEB_MERCATOR_MAX_LAT,
  type Point2,
} from '@bessel/map-projection';

export type GroundTrackProjection = 'equirectangular' | 'mercator';

export interface GroundTrackMapProps {
  /** Sub-spacecraft longitude and latitude samples, radians. */
  readonly lon: Float64Array | readonly number[];
  readonly lat: Float64Array | readonly number[];
  readonly projection?: GroundTrackProjection;
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
  readonly testId?: string;
}

// On the unit sphere (radius 1) each projection's x spans [-pi, pi]; y spans
// [-pi/2, pi/2] for equirectangular and [-pi, pi] for Web Mercator (square).
const Y_MAX: Record<GroundTrackProjection, number> = {
  equirectangular: Math.PI / 2,
  mercator: Math.PI,
};

function project(lon: number, lat: number, kind: GroundTrackProjection): Point2 {
  const ll = { lon, lat };
  return kind === 'mercator' ? webMercatorForward(ll, 1) : equirectangularForward(ll, 1);
}

export function GroundTrackMap(props: GroundTrackMapProps): JSX.Element {
  const w = props.width ?? 280;
  const h = props.height ?? 140;
  const kind = props.projection ?? 'equirectangular';
  const n = Math.min(props.lon.length, props.lat.length);
  const yMax = Y_MAX[kind];

  // Project each sample, normalize to the SVG box (north up), and split the polyline
  // where longitude wraps across the antimeridian so the track does not streak. A
  // segment with a single point (one sample trapped between two wraps) cannot draw as
  // a polyline, so it is kept and rendered as a dot rather than silently dropped.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let prevX = NaN;
  for (let i = 0; i < n; i++) {
    const lat = Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, props.lat[i]!));
    const p = project(props.lon[i]!, kind === 'mercator' ? lat : props.lat[i]!, kind);
    const x = ((p.x + Math.PI) / (2 * Math.PI)) * w;
    const y = ((yMax - p.y) / (2 * yMax)) * h;
    if (!Number.isNaN(prevX) && Math.abs(x - prevX) > w / 2) {
      if (current.length >= 1) segments.push(current);
      current = [];
    }
    current.push({ x, y });
    prevX = x;
  }
  if (current.length >= 1) segments.push(current);

  return (
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
    </svg>
  );
}
