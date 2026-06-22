import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { CatalogLoader } from './CatalogLoader.tsx';
import { LiveGeometryReadout } from './LiveGeometryReadout.tsx';
import { ObjectBrowser } from './ObjectBrowser.tsx';
import { ReadoutPanel } from './ReadoutPanel.tsx';
import { StateVectorPanel, type BodyState } from './StateVectorPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { TimelineControls, humanizeRate } from './TimelineControls.tsx';
import { CameraFrameControls } from './CameraFrameControls.tsx';
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
    expect(out).toContain('data-testid="readout-copy"');
    expect(out).toContain('aria-label="Copy readouts"');
  });
});

describe('@bessel/ui StateVectorPanel', () => {
  const state: BodyState = {
    target: 'Cassini',
    center: 'Saturn',
    r: [1000.5, -2000.25, 300],
    v: [1.5, -2.25, 0.5],
    semiMajorKm: 120000,
    ecc: 0.3,
    incDeg: 28.5,
    raanDeg: 120,
    argpDeg: 45,
    trueAnomalyDeg: 90,
  };

  it('renders r/v vectors, elements, the frame select, and a copy button', () => {
    const out = html(
      createElement(StateVectorPanel, {
        target: 'Cassini',
        state,
        frame: 'J2000',
        onFrameChange: () => {},
      }),
    );
    expect(out).toContain('data-testid="state-r"');
    expect(out).toContain('[1000.500, -2000.250, 300.000] km');
    expect(out).toContain('data-testid="state-v"');
    expect(out).toContain('120,000 km'); // semi-major
    expect(out).toContain('28.50 deg'); // inclination
    expect(out).toContain('data-testid="state-copy"');
    // The selected frame is reflected in the option set.
    expect(out).toContain('data-testid="state-frame-select"');
  });

  it('carries a non-standard frame into the option list', () => {
    const out = html(
      createElement(StateVectorPanel, { target: 'Cassini', state, frame: 'IAU_TITAN', onFrameChange: () => {} }),
    );
    expect(out).toContain('value="IAU_TITAN"');
  });

  it('shows n/a and no copy button when the state is null', () => {
    const out = html(
      createElement(StateVectorPanel, { target: 'Cassini', state: null, frame: 'J2000', onFrameChange: () => {} }),
    );
    expect(out).toContain('data-testid="state-empty"');
    expect(out).not.toContain('data-testid="state-copy"');
  });
});

describe('@bessel/ui LiveGeometryReadout', () => {
  it('formats finite values, shows n/a for null, and uses distinct testids', () => {
    const out = html(
      createElement(LiveGeometryReadout, {
        target: 'Saturn',
        readouts: {
          rangeKm: 1234567,
          altitudeKm: 1174299,
          phaseDeg: 42.34,
          incidenceDeg: null,
          emissionDeg: null,
        },
      }),
    );
    expect(out).toContain('data-testid="live-readout"');
    expect(out).toContain('aria-label="Live geometry for Saturn"');
    expect(out).toContain('1,234,567 km');
    expect(out).toContain('42.3 deg');
  });

  it('shows n/a for null geometry', () => {
    const out = html(
      createElement(LiveGeometryReadout, {
        target: 'Probe',
        readouts: {
          rangeKm: null,
          altitudeKm: null,
          phaseDeg: null,
          incidenceDeg: null,
          emissionDeg: null,
        },
      }),
    );
    expect(out).toContain('data-testid="live-readout-range"');
    expect(out).toContain('n/a');
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
    // No reset affordance unless the parent opts in.
    expect(out).not.toContain('data-testid="settings-reset"');
  });

  it('renders a reset button only when onReset is provided', () => {
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
    const out = html(createElement(SettingsPanel, { settings, onChange: () => {}, onReset: () => {} }));
    expect(out).toContain('data-testid="settings-reset"');
    expect(out).toContain('Reset to defaults');
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

  it('labels the scrub track ends with the formatted window start and end', () => {
    const out = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-07-01',
        timeSystem: 'UTC',
        min: 0,
        max: 100,
        value: 50,
        minLabel: '2004-06-22T00:00:00',
        maxLabel: '2004-08-22T00:00:00',
        onPlayToggle: () => {},
        onRateChange: () => {},
        onScrub: () => {},
        onTimeSystemChange: () => {},
      }),
    );
    expect(out).toContain('data-testid="scrub-bounds"');
    expect(out).toContain('2004-06-22T00:00:00');
    expect(out).toContain('2004-08-22T00:00:00');
  });

  it('renders transport controls, disabling the back/forward ends at the bounds', () => {
    const atStart = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-07-01',
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
    // All five transport controls render.
    for (const id of ['timeline-to-start', 'timeline-step-back', 'timeline-play', 'timeline-step-forward', 'timeline-to-end']) {
      expect(atStart).toContain(`data-testid="${id}"`);
    }
    // At the window start the back/jump-start controls are disabled; forward is live.
    // (React renders data-testid before the boolean disabled attribute.)
    expect(atStart).toMatch(/data-testid="timeline-to-start"[^>]*\bdisabled\b/);
    expect(atStart).toMatch(/data-testid="timeline-step-back"[^>]*\bdisabled\b/);
    expect(atStart).not.toMatch(/data-testid="timeline-step-forward"[^>]*\bdisabled\b/);

    // At the window end the forward/jump-end controls are disabled instead.
    const atEnd = html(
      createElement(TimelineControls, {
        playing: false,
        rate: 1,
        epochLabel: '2004-08-01',
        timeSystem: 'UTC',
        min: 0,
        max: 100,
        value: 100,
        onPlayToggle: () => {},
        onRateChange: () => {},
        onScrub: () => {},
        onTimeSystemChange: () => {},
      }),
    );
    expect(atEnd).toMatch(/data-testid="timeline-to-end"[^>]*\bdisabled\b/);
    expect(atEnd).not.toMatch(/data-testid="timeline-to-start"[^>]*\bdisabled\b/);
  });

  it('shows the epoch and a time-system selector with the active system chosen', () => {
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
    expect(out).toContain('2004-07-01T00:00:00');
    expect(out).toContain('data-testid="time-system"');
    // The time system is a select; both options render and UTC is the active value.
    expect(out).toMatch(/<select[^>]*data-testid="time-system"/);
    expect(out).toContain('>UTC</option>');
    expect(out).toContain('>TDB</option>');
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

describe('@bessel/ui humanizeRate', () => {
  it('glosses rates as a plain-language cadence', () => {
    expect(humanizeRate(86400)).toBe('1 day/sec');
    expect(humanizeRate(604800)).toBe('7 days/sec');
    expect(humanizeRate(3600)).toBe('1 hour/sec');
    expect(humanizeRate(60)).toBe('1 min/sec');
    expect(humanizeRate(1)).toBe('1 sec/sec');
  });
});

describe('@bessel/ui TimelineControls enrichment (B8)', () => {
  const base = {
    playing: false,
    rate: 1,
    epochLabel: '2004-07-01',
    timeSystem: 'UTC' as const,
    min: 0,
    max: 100,
    value: 0,
    onPlayToggle: () => {},
    onRateChange: () => {},
    onScrub: () => {},
    onTimeSystemChange: () => {},
  };

  it('glosses the rate options and renders a go-to-epoch field', () => {
    const out = html(createElement(TimelineControls, base));
    expect(out).toContain('86400x (~ 1 day/sec)');
    expect(out).toContain('3600x (~ 1 hour/sec)');
    expect(out).toContain('data-testid="goto-epoch"');
    expect(out).toContain('aria-label="Go to epoch (UTC)"');
  });

  it('shows the next event with its T-minus, or none', () => {
    const withNext = html(
      createElement(TimelineControls, { ...base, nextEventLabel: 'Periapsis', nextEventTMinus: '2h 5m' }),
    );
    expect(withNext).toContain('Next: Periapsis T-2h 5m');
    const none = html(createElement(TimelineControls, base));
    expect(none).toContain('No upcoming events');
  });

  it('renders a visible marker label and a loud go-to-epoch error when set', () => {
    const out = html(
      createElement(TimelineControls, {
        ...base,
        annotations: [{ id: 'soi', et: 50, label: 'Saturn orbit insertion' }],
        goToEpochError: 'Could not parse epoch',
      }),
    );
    expect(out).toContain('class="bessel-marker-label"');
    expect(out).toContain('Saturn orbit insertion');
    expect(out).toMatch(/role="alert"[^>]*data-testid="goto-epoch-error"/);
  });
});

describe('@bessel/ui CameraFrameControls (B9)', () => {
  const base = {
    frame: 'J2000',
    onFrame: () => {},
    onDolly: () => {},
    onCrane: () => {},
  };

  it('keeps the frame select operable and hints the Frame-mode coupling', () => {
    const off = html(createElement(CameraFrameControls, { ...base, frameMode: false }));
    expect(off).toContain('data-testid="camera-frame-select"');
    // The select must NOT be disabled (regression guard against the old dead control).
    expect(off).not.toMatch(/data-testid="camera-frame-select"[^>]*disabled/);
    expect(off).toContain('Picks Frame mode');
    const on = html(createElement(CameraFrameControls, { ...base, frameMode: true }));
    expect(on).toContain('Frame locked');
  });
});
