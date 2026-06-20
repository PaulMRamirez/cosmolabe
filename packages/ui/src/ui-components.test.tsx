import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ObjectBrowser } from './ObjectBrowser.tsx';
import { ReadoutPanel } from './ReadoutPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { TimelineControls } from './TimelineControls.tsx';
import { KeyboardHelp } from './KeyboardHelp.tsx';
import { OpsPanel } from './OpsPanel.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('@bessel/ui OpsPanel', () => {
  it('lists registry missions and shows the telemetry residual', () => {
    const out = html(
      createElement(OpsPanel, {
        missions: [{ id: 'cassini-saturn', name: 'Cassini at Saturn' }],
        onLoadMission: () => {},
        onRunTour: () => {},
        telemetryResidualKm: 2.29,
      }),
    );
    expect(out).toContain('data-testid="mission-cassini-saturn"');
    expect(out).toContain('Cassini at Saturn');
    expect(out).toContain('data-testid="run-tour"');
    expect(out).toContain('Telemetry residual: 2.29 km');
  });

  it('shows no-telemetry state when the residual is null', () => {
    const out = html(
      createElement(OpsPanel, {
        missions: [],
        onLoadMission: () => {},
        onRunTour: () => {},
        telemetryResidualKm: null,
      }),
    );
    expect(out).toContain('Telemetry: none');
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
        onToggleSelect: () => {},
        onToggleVisible: () => {},
      }),
    );
    expect(out).toContain('data-testid="select-Saturn"');
    expect(out).toContain('data-testid="visible-Cassini"');
    // Cassini is selected, Saturn is not (attribute order is React prop order).
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="select-Cassini"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*data-testid="select-Saturn"/);
  });
});

describe('@bessel/ui TimelineControls annotations', () => {
  it('renders a labelled marker per annotation positioned by fraction', () => {
    const out = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-07-01',
        min: 0,
        max: 100,
        value: 50,
        annotations: [{ id: 'soi', et: 50, label: 'Saturn orbit insertion' }],
        onPlayToggle: () => {},
        onRateChange: () => {},
        onScrub: () => {},
      }),
    );
    expect(out).toContain('data-testid="marker-soi"');
    expect(out).toContain('left:50%');
    expect(out).toContain('aria-label="Event: Saturn orbit insertion"');
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
