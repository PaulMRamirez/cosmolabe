// The MMGIS-shaped fixture host: a surface-GIS-shaped page that owns its own
// map and time cursor and hosts the Bessel panel behind the bessel=1 flag
// (the W4 "MMGIS embed behind a flag" criterion, on a fixture named as
// such). Plain DOM on purpose: a real host is not our React app. The host
// draws its own computed layer on its own map, hands the same layer to the
// panel through the first host data adapter (M-0011, authority 'host'),
// runs two exploratory compute jobs beside it, and syncs through the
// PanelController surface: deep-link startTime in, slider to setCursor in,
// in-panel chart picks out to the slider, the URL, and the cursor chip,
// selection out to the selection chip, and focusProduct in from the focus
// button and the besselFocus parameter.

import {
  createMmgisDataAdapter,
  cursorEtFromStartTime,
  formatMmgisParams,
  mount,
  parseMmgisParams,
  startTimeFromCursorEt,
  type MmgisComputedLayer,
  type MmgisPanelLink,
  type PanelJob,
} from '@bessel/panel';
import { FIXTURE_EPOCH, fixtureComputeAdapter } from './fixture-compute.ts';

const HOUR = 3600;

// The host's own computed layer, in MMGIS-shaped terms (a traverse path the
// host's own tool produced). The host draws it on its map AND hands it to
// the panel; the two renderings share one provenance.
const TRAVERSE: MmgisComputedLayer = {
  name: 'Traverse path (sol 3125)',
  mission: 'MSL',
  tool: 'PathTool',
  toolVersion: '2.9.1',
  layerUuid: 'a1b2c3d4',
  generatedAt: '2026-07-01T12:00:00Z',
  crs: { body: 'MARS', frame: 'IAU_MARS', radiusKm: 3389.5 },
  form: 'polyline',
  coordinates: [
    [137.35, -4.72],
    [137.38, -4.7],
    [137.42, -4.66],
    [137.44, -4.61],
    [137.41, -4.58],
  ],
};

const PANEL_JOBS: readonly PanelJob[] = [
  {
    label: 'Cassini and Sun access from Saturn',
    spec: (et0) => ({
      kind: 'access',
      request: {
        observer: 'SATURN',
        targets: ['CASSINI', 'SUN'],
        span: [et0, et0 + 4 * HOUR],
        step: HOUR,
        constraints: [{ kind: 'range', maxKm: 2.0e5 }],
        correction: 'NONE',
      },
    }),
  },
  {
    label: 'Saturn to Cassini range',
    spec: (et0) => ({
      kind: 'series',
      request: {
        providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI' }],
        span: [et0, et0 + 4 * HOUR],
        step: 60,
        frame: 'J2000',
        correction: 'NONE',
        chunks: 4,
      },
    }),
  },
];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`mmgis fixture host: missing #${id}`);
  return node as T;
}

// ── the host's own map (SVG, equirectangular, host-owned rendering) ─────────
function drawMap(root: HTMLElement, link: MmgisPanelLink): void {
  const w = 560;
  const h = 300;
  const lons = TRAVERSE.coordinates.map(([lon]) => lon);
  const lats = TRAVERSE.coordinates.map(([, lat]) => lat);
  const pad = 0.05;
  const lonMin = Math.min(...lons) - pad;
  const lonMax = Math.max(...lons) + pad;
  const latMin = Math.min(...lats) - pad;
  const latMax = Math.max(...lats) + pad;
  const x = (lon: number): number => ((lon - lonMin) / (lonMax - lonMin)) * w;
  const y = (lat: number): number => h - ((lat - latMin) / (latMax - latMin)) * h;
  const points = TRAVERSE.coordinates
    .map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`)
    .join(' ');
  const viewport =
    link.mapLon !== undefined
      ? `mission ${link.mission ?? '?'} at ${link.mapLon}, ${link.mapLat} (zoom ${link.mapZoom})`
      : `mission ${link.mission ?? TRAVERSE.mission}`;
  root.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-testid="mmgis-map"
         style="background:#0b0e14;border:1px solid #334">
      <g stroke="#233" stroke-width="1">
        ${[1, 2, 3].map((i) => `<line x1="${(w / 4) * i}" y1="0" x2="${(w / 4) * i}" y2="${h}"/>`).join('')}
        ${[1, 2].map((i) => `<line x1="0" y1="${(h / 3) * i}" x2="${w}" y2="${(h / 3) * i}"/>`).join('')}
      </g>
      <polyline data-testid="mmgis-map-layer" points="${points}" fill="none"
                stroke="#e0a458" stroke-width="2"/>
    </svg>
    <div class="chip" data-testid="mmgis-viewport">${viewport}</div>`;
}

// ── wiring ──────────────────────────────────────────────────────────────────
const link = parseMmgisParams(location.search);
drawMap(el('mmgis-map-root'), link);

if (!link.bessel) {
  el('panel-note').hidden = false;
} else {
  const slider = el<HTMLInputElement>('time-slider');
  const cursorChip = el('cursor-chip');
  const selectionChip = el('selection-chip');

  const controller = mount(el('panel-host'), {
    data: createMmgisDataAdapter([TRAVERSE], fixtureComputeAdapter(PANEL_JOBS)),
  });

  let anchorEt: number | null = null;
  const showCursor = (et: number): void => {
    cursorChip.textContent = `cursor: ${
      anchorEt === null ? et.toFixed(0) : startTimeFromCursorEt(et, FIXTURE_EPOCH, anchorEt)
    }`;
  };
  const writeDeepLink = (et: number): void => {
    if (anchorEt === null) return;
    const qs = formatMmgisParams({
      ...link,
      bessel: true,
      startTime: startTimeFromCursorEt(et, FIXTURE_EPOCH, anchorEt),
    });
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  };

  controller.onSpan((span) => {
    // The panel's jobs start at the resolved epoch, so the span start is the
    // civil-anchor for the deep-link time mapping.
    anchorEt = span.et0;
    slider.min = String(span.et0);
    slider.max = String(span.et1);
    slider.disabled = false;
    const initial =
      link.startTime !== null && link.startTime !== undefined
        ? cursorEtFromStartTime(link.startTime, FIXTURE_EPOCH, span.et0)
        : null;
    const et = initial ?? span.et0;
    slider.value = String(et);
    controller.setCursor(et);
    showCursor(et);
    if (link.besselFocus) controller.focusProduct(link.besselFocus);
  });

  slider.addEventListener('input', () => {
    const et = Number(slider.value);
    controller.setCursor(et);
    showCursor(et);
    writeDeepLink(et);
  });

  controller.onCursor((et) => {
    slider.value = String(et);
    showCursor(et);
    writeDeepLink(et);
  });

  controller.onSelection((sel) => {
    selectionChip.textContent = `selection: ${sel.label} [${sel.authority}]`;
  });

  el('focus-host').addEventListener('click', () => controller.focusProduct('host-0'));
}
