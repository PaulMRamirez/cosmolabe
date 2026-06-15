// The mission viewer on the modern shell. It owns the state store and
// the BesselEngine, subscribes to store slices, and lays its controls out into
// the app shell's dock regions: objects on the left, the viewport in the center,
// tools on the right, the timeline along the bottom. The component stays
// presentational; all imperative work lives in the engine.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INNER_SYSTEM } from '@bessel/scene';
import {
  BookmarksPanel,
  CaptureControls,
  CatalogLoader,
  KeyboardHelp,
  MeasurePanel,
  ObjectBrowser,
  ObjectInspector,
  OpsPanel,
  PanelContainer,
  ReadoutPanel,
  SearchBox,
  SettingsPanel,
  ThemeToggle,
  TimelineControls,
  Tooltip,
  ViewControls,
  useKeyboardShortcuts,
  type KeyboardAction,
} from '@bessel/ui';
import { createAppStore, useStore, type AppStore } from './store/index.ts';
import { useBesselEngine } from './engine/index.ts';
import { createMissionRegistry } from './missions.ts';
import { AppShell } from './shell/index.ts';

const SPICE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  INNER_SYSTEM.map((p) => [p.name, p.spiceId]),
);

export function BesselViewer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) storeRef.current = createAppStore();
  const store = storeRef.current;
  const engine = useBesselEngine(canvasRef, store);
  const [query, setQuery] = useState('');

  const status = useStore(store, (s) => s.status);
  const ready = useStore(store, (s) => s.ready);
  const playing = useStore(store, (s) => s.playing);
  const rate = useStore(store, (s) => s.rate);
  const et = useStore(store, (s) => s.et);
  const bounds = useStore(store, (s) => s.bounds);
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const focus = useStore(store, (s) => s.focus);
  const instruments = useStore(store, (s) => s.instruments);
  const footprintPoints = useStore(store, (s) => s.footprintPoints);
  const fovOk = useStore(store, (s) => s.fovOk);
  const selection = useStore(store, (s) => s.selection);
  const track = useStore(store, (s) => s.track);
  const settings = useStore(store, (s) => s.settings);
  const visibility = useStore(store, (s) => s.visibility);
  const readouts = useStore(store, (s) => s.readouts);
  const helpOpen = useStore(store, (s) => s.helpOpen);
  const recording = useStore(store, (s) => s.recording);
  const theme = useStore(store, (s) => s.theme);
  const telemetryResidualKm = useStore(store, (s) => s.telemetryResidualKm);
  const objects = useStore(store, (s) => s.objects);
  const loadedName = useStore(store, (s) => s.loadedName);
  const loadError = useStore(store, (s) => s.loadError);
  const measurement = useStore(store, (s) => s.measurement);
  const bookmarks = useStore(store, (s) => s.bookmarks);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    store.setState((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }));
  }, [store]);

  const onKeyboardAction = useCallback(
    (action: KeyboardAction): void => engine?.keyboardAction(action),
    [engine],
  );
  useKeyboardShortcuts(onKeyboardAction);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? objects.filter((e) => e.name.toLowerCase().includes(q)) : objects;
  }, [query, objects]);

  // "Center on" targets come from the loaded mission (bodies and spacecraft), so
  // there is no hardcoded body list and they update when a catalog loads.
  const centerTargets = useMemo(
    () => objects.filter((e) => e.kind !== 'instrument').map((e) => e.name),
    [objects],
  );

  // The bundled missions come from the plugin registry (surfacing it in the shell).
  const registryRef = useRef(createMissionRegistry());
  const missions = useMemo(
    () => registryRef.current.list().map((p) => ({ id: p.id, name: p.name })),
    [],
  );

  const focusEntry = objects.find((e) => e.id === focus);
  const inspectorFields = [{ label: 'SPICE id', value: SPICE_IDS[focus] ?? '-' }];

  const annotations =
    bounds[1] > bounds[0]
      ? [
          {
            id: 'soi',
            et: bounds[0] + 0.15 * (bounds[1] - bounds[0]),
            label: 'Saturn orbit insertion',
          },
        ]
      : [];

  const actions = (
    <Tooltip label="Toggle light / dark theme">
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </Tooltip>
  );

  const left = (
    <>
      <PanelContainer title="Mission" testId="panel-mission">
        <CatalogLoader
          onLoad={(file) => void engine?.loadCatalog(file)}
          status={loadedName ? `Loaded ${loadedName}: ${objects.length} objects` : null}
          error={loadError}
        />
      </PanelContainer>
      <PanelContainer title="Objects" testId="panel-objects">
        <SearchBox value={query} onChange={setQuery} placeholder="Filter objects" />
        <ObjectBrowser
          entries={filteredEntries}
          selection={selection}
          visibility={visibility}
          onToggleSelect={(id) => engine?.toggleSelectObject(id)}
          onToggleVisible={(id, visible) => engine?.toggleVisibleObject(id, visible)}
        />
      </PanelContainer>
      <PanelContainer title="Camera" testId="panel-camera">
        <ViewControls
          bodies={centerTargets}
          focus={focus}
          onCenter={(b) => engine?.centerOn(b)}
          onViewTopDown={() => engine?.viewTopDown()}
          onViewFromSun={() => engine?.viewFromSun()}
          onViewAlongVelocity={() => engine?.viewAlongVelocity()}
        />
      </PanelContainer>
    </>
  );

  const center = (
    <div className="bessel-viewer">
      <canvas
        ref={canvasRef}
        id="viewport"
        aria-label="3D viewport"
        width={960}
        height={600}
        data-ready={ready}
        data-footprint-points={footprintPoints}
        data-fov={fovOk ? '1' : '0'}
        data-cam-target={focus}
        data-cam-mode={track ? 'track' : 'orbit'}
        data-selection={selection.join(',')}
        data-epoch={epochLabel}
        data-testid="viewport"
      />
      <div className="bessel-hud" data-testid="status">
        {status}
      </div>
      <div className="bessel-viewcontrols" role="group" aria-label="Instruments and sharing">
        <button
          type="button"
          onClick={() => engine?.toggleInstruments()}
          aria-pressed={instruments}
          data-testid="toggle-instruments"
        >
          {instruments ? 'Hide instruments' : 'Show instruments'}
        </button>
        <button
          type="button"
          onClick={() => engine?.toggleTrack()}
          aria-pressed={track}
          data-testid="toggle-track"
        >
          {track ? 'Stop tracking' : 'Track spacecraft'}
        </button>
        <button type="button" onClick={() => void engine?.share()} data-testid="share">
          Share view
        </button>
        <span className="bessel-selection" data-testid="selection-label">
          {selection.length ? `Selected: ${selection.join(', ')}` : 'No selection'}
        </span>
      </div>
      <button
        type="button"
        className="bessel-help-button"
        onClick={() => engine?.setHelpOpen(true)}
        aria-label="Keyboard shortcuts help"
        data-testid="help-button"
      >
        ?
      </button>
      <KeyboardHelp open={helpOpen} onClose={() => engine?.setHelpOpen(false)} />
    </div>
  );

  const right = (
    <>
      <PanelContainer title="Visualization" testId="panel-visualization">
        <SettingsPanel settings={settings} onChange={(k, v) => engine?.setSetting(k, v)} />
      </PanelContainer>
      <PanelContainer title="Selection" testId="panel-selection">
        <ObjectInspector name={focus} kind={focusEntry?.kind} fields={inspectorFields} />
        <ReadoutPanel target={focus} readouts={readouts} />
      </PanelContainer>
      <PanelContainer title="Measure" testId="panel-measure">
        <MeasurePanel
          from={measurement?.from ?? null}
          to={measurement?.to ?? null}
          distanceKm={measurement?.distanceKm ?? null}
          relativeSpeedKmS={measurement?.relativeSpeedKmS ?? null}
          angleDeg={measurement?.angleDeg ?? null}
        />
      </PanelContainer>
      <PanelContainer title="Operations" testId="panel-ops">
        <OpsPanel
          missions={missions}
          onLoadMission={(id) => void engine?.loadMission(registryRef.current, id)}
          onRunTour={() => engine?.runTour()}
          telemetryResidualKm={telemetryResidualKm}
        />
      </PanelContainer>
      <PanelContainer title="Saved views" testId="panel-views">
        <BookmarksPanel
          bookmarks={bookmarks}
          onSave={(name) => void engine?.saveBookmark(name)}
          onApply={(id) => void engine?.applyBookmark(id)}
          onDelete={(id) => void engine?.deleteBookmark(id)}
        />
      </PanelContainer>
      <PanelContainer title="Capture" testId="panel-capture">
        <CaptureControls
          recording={recording}
          onCaptureStill={() => engine?.captureStill()}
          onToggleRecording={() => engine?.toggleRecording()}
        />
      </PanelContainer>
    </>
  );

  const bottom = (
    <TimelineControls
      playing={playing}
      rate={rate}
      epochLabel={epochLabel}
      min={bounds[0]}
      max={bounds[1]}
      value={et}
      annotations={annotations}
      onPlayToggle={() => engine?.togglePlay()}
      onRateChange={(r) => engine?.setRate(r)}
      onScrub={(v) => engine?.scrub(v)}
      onAnnotationSelect={(v) => engine?.scrub(v)}
    />
  );

  return (
    <AppShell
      title="Bessel"
      subtitle={loadedName ?? undefined}
      actions={actions}
      left={left}
      center={center}
      right={right}
      bottom={bottom}
    />
  );
}
