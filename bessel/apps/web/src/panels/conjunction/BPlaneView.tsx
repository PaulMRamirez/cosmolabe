// The B-plane (encounter-plane) viewer: a lightweight SVG plot of the conjunction encounter
// plane for a selected screened event. It draws the 1- and 3-sigma combined-covariance
// ellipses, the miss vector from the origin (the primary mean) to the secondary projected
// position, the combined hard-body circle at the miss point, and the encounter-plane (RIC-style)
// axis labels. SVG only (no chart library); it reads the already-computed geometry off the
// store's conjunctionEvent slice. Presentational.

import type { ConjunctionEventResult } from '../../store/index.ts';
import { ellipsePoints } from '../../conjunction/bplane-geometry.ts';

const SIZE = 240;
const PAD = 24;

/** Map an encounter-plane (km) point to SVG pixels (+y is up, so the SVG y is flipped). */
function px(xKm: number, yKm: number, extentKm: number): [number, number] {
  const scale = (SIZE - 2 * PAD) / (2 * extentKm);
  return [SIZE / 2 + xKm * scale, SIZE / 2 - yKm * scale];
}

export function BPlaneView(props: { readonly event: ConjunctionEventResult }): JSX.Element {
  const ev = props.event;
  const ext = ev.extentKm;
  const [ox, oy] = px(0, 0, ext);
  const [mx, my] = px(ev.missXKm, ev.missYKm, ext);
  const rPx = Math.max(1, (ev.radiusKm / (2 * ext)) * (SIZE - 2 * PAD));
  const poly = (a: number, b: number, ang: number): string =>
    ellipsePoints(a, b, ang, 0, 0)
      .map(([x, y]) => px(x, y, ext).map((n) => n.toFixed(2)).join(','))
      .join(' ');

  return (
    <div className="bessel-bplane" data-testid="bplane-view">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Encounter-plane plot">
        <line x1={PAD} y1={oy} x2={SIZE - PAD} y2={oy} className="bessel-bplane-axis" />
        <line x1={ox} y1={PAD} x2={ox} y2={SIZE - PAD} className="bessel-bplane-axis" />
        <text x={SIZE - PAD + 2} y={oy - 3} className="bessel-bplane-label" data-testid="bplane-axis-x">
          U (cross-track)
        </text>
        <text x={ox + 3} y={PAD - 4} className="bessel-bplane-label" data-testid="bplane-axis-y">
          V (radial)
        </text>
        {ev.ellipses.map((el) => (
          <polygon
            key={el.sigma}
            points={poly(el.semiMajorKm, el.semiMinorKm, el.angleRad)}
            className={`bessel-bplane-ellipse bessel-bplane-ellipse-${el.sigma}sigma`}
            data-testid={`bplane-ellipse-${el.sigma}sigma`}
          />
        ))}
        <line x1={ox} y1={oy} x2={mx} y2={my} className="bessel-bplane-miss" data-testid="bplane-miss" />
        <circle cx={mx} cy={my} r={rPx} className="bessel-bplane-hardbody" data-testid="bplane-hardbody" />
        <circle cx={ox} cy={oy} r={2.5} className="bessel-bplane-origin" />
      </svg>
      <p className="bessel-loader-hint" data-testid="bplane-caption">
        {ev.hasCovariance
          ? '1-sigma and 3-sigma covariance ellipses, miss vector, and hard-body circle.'
          : 'No covariance in this catalog (OEM/TLE): miss vector and hard-body circle only.'}
      </p>
    </div>
  );
}
