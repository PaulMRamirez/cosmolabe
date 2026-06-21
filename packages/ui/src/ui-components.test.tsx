import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { CatalogLoader } from './CatalogLoader.tsx';
import { ObjectBrowser } from './ObjectBrowser.tsx';
import { ReadoutPanel } from './ReadoutPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { TimelineControls } from './TimelineControls.tsx';
import { KeyboardHelp } from './KeyboardHelp.tsx';
import { OpsPanel } from './OpsPanel.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('@bessel/ui OpsPanel', () => {
  it('lists registry missions and the guided tour', () => {
    const out = html(
      createElement(OpsPanel, {
        missions: [{ id: 'cassini-saturn', name: 'Cassini at Saturn' }],
        onLoadMission: () => {},
        onRunTour: () => {},
      }),
    );
    expect(out).toContain('data-testid="mission-cassini-saturn"');
    expect(out).toContain('Cassini at Saturn');
    expect(out).toContain('data-testid="run-tour"');
    // The live telemetry residual now lives in the HUD ops strip, not here.
    expect(out).not.toContain('data-testid="telemetry-residual"');
  });

  it('shows an empty-missions hint when none are bundled', () => {
    const out = html(
      createElement(OpsPanel, {
        missions: [],
        onLoadMission: () => {},
        onRunTour: () => {},
      }),
    );
    expect(out).toContain('none bundled');
  });
});

describe('@bessel/ui CatalogLoader', () => {
  it('renders one-click sample chips and a load-from-URL field when wired', () => {
    const out = html(
      createElement(CatalogLoader, {
        onLoad: () => {},
        samples: [{ label: 'Cassini at Saturn', url: '/samples/cassini-saturn.json' }],
        onLoadSample: () => {},
        onLoadUrl: () => {},
      }),
    );
    expect(out).toContain('data-testid="load-sample-cassini-saturn.json"');
    expect(out).toContain('Cassini at Saturn');
    expect(out).toContain('data-testid="load-url-input"');
    expect(out).toContain('data-testid="load-url-submit"');
  });

  it('omits the URL field when no onLoadUrl is given', () => {
    const out = html(createElement(CatalogLoader, { onLoad: () => {} }));
    expect(out).not.toContain('data-testid="load-url-input"');
  });
});

describe('@bessel/ui ReadoutPanel', () => {
  it('formats values and shows n/a for null', () => {
    const out = html(
      createElement(ReadoutPanel, {
        target: 'Saturn',
        readouts: {
          rangeKm: 1234567,
          altitudeKm: 1174299,
          phaseDeg: 42.34,
          incidenceDeg: null,
          emissionDeg: 5.1,
        },
      }),
    );
    expect(out).toContain('1,234,567 km');
    expect(out).toContain('42.3 deg');
    expect(out).toContain('n/a');
    expect(out).toContain('aria-label="Geometry readouts for Saturn"');
  });
});

describe('@bessel/ui SettingsPanel', () => {
  it('renders a labelled checkbox per setting', () => {
    const settings = {
      trajectory: true,
      orbits: true,
      labels: true,
      fov: false,
      footprint: true,
      axes: false,
      stars: true,
      atmosphere: false,
      shadows: false,
      realImagery: false,
    };
    const out = html(createElement(SettingsPanel, { settings, onChange: () => {} }));
    expect(out).toContain('data-testid="setting-trajectory"');
    expect(out).toContain('data-testid="setting-shadows"');
    expect(out).toContain('data-testid="setting-realImagery"');
    expect(out).toContain('Visualization');
  });
});

describe('@bessel/ui ObjectBrowser', () => {
  it('renders rows with aria-pressed reflecting the selection', () => {
    const out = html(
      createElement(ObjectBrowser, {
        entries: [
          { id: 'Saturn', name: 'Saturn', kind: 'body' },
          { id: 'Cassini', name: 'Cassini', kind: 'spacecraft' },
        ],
        selection: ['Cassini'],
        visibility: { Saturn: true },
        focus: 'Saturn',
        onToggleSelect: () => {},
        onToggleVisible: () => {},
        onCenter: () => {},
      }),
    );
    expect(out).toContain('data-testid="select-Saturn"');
    expect(out).toContain('data-testid="visible-Cassini"');
    // Cassini is selected, Saturn is not (attribute order is React prop order).
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="select-Cassini"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*data-testid="select-Saturn"/);
    // The crosshair reads "Fly to", the focused row carries aria-current, and a legend
    // disambiguates selected from centered.
    expect(out).toContain('aria-label="Fly to Saturn"');
    expect(out).toContain('title="Fly to Saturn"');
    expect(out).toMatch(/aria-current="true"[^>]*data-testid="select-Saturn"/);
    expect(out).toContain('data-testid="object-browser-legend"');
    expect(out).toContain('selected');
    expect(out).toContain('Crosshair');
  });

  it('omits the legend when centering is unavailable', () => {
    const out = html(
      createElement(ObjectBrowser, {
        entries: [{ id: 'Saturn', name: 'Saturn', kind: 'body' }],
        selection: [],
        visibility: { Saturn: true },
        onToggleSelect: () => {},
        onToggleVisible: () => {},
      }),
    );
    expect(out).not.toContain('object-browser-legend');
  });
});

describe('@bessel/ui TimelineControls annotations', () => {
  it('renders a labelled marker per annotation positioned by fraction', () => {
    const out = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-07-01',
        timeSystem: 'UTC',
        min: 0,
        max: 100,
        value: 50,
        annotations: [{ id: 'soi', et: 50, label: 'Saturn orbit insertion' }],
        onPlayToggle: () => {},
        onRateChange: () => {},
        onScrub: () => {},
        onTimeSystemChange: () => {},
      }),
    );
    expect(out).toContain('data-testid="marker-soi"');
    expect(out).toContain('left:50%');
    expect(out).toContain('aria-label="Event: Saturn orbit insertion"');
  });

  it('suffixes the epoch with its time system and marks the active system pressed', () => {
    const out = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-07-01T00:00:00',
        timeSystem: 'UTC',
        min: 0,
        max: 100,
        value: 0,
        onPlayToggle: () => {},
        onRateChange: () => {},
        onScrub: () => {},
        onTimeSystemChange: () => {},
      }),
    );
    expect(out).toContain('2004-07-01T00:00:00 UTC');
    expect(out).toContain('data-testid="time-system"');
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="time-system-utc"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*data-testid="time-system-tdb"/);
  });
});

describe('@bessel/ui KeyboardHelp', () => {
  it('renders a modal dialog listing shortcuts when open', () => {
    const out = html(createElement(KeyboardHelp, { open: true, onClose: () => {} }));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('Space');
  });
  it('renders nothing when closed', () => {
    expect(html(createElement(KeyboardHelp, { open: false, onClose: () => {} }))).toBe('');
  });
});
