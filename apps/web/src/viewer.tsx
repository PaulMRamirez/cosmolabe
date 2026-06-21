// The mission viewer on the modern shell. It owns the state store and
// the BesselEngine, subscribes to store slices, and lays its controls out into
// the app shell's dock regions: objects on the left, the viewport in the center,
// tools on the right, the timeline along the bottom. The component stays
// presentational; all imperative work lives in the engine.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SOLAR_SYSTEM } from '@bessel/scene';
import { StatusDot, type StatusTone } from '@bessel/selene-design';
import {
  BookmarksPanel,
  CameraFrameControls,
  CaptureControls,
  CatalogLoader,
  DEFAULT_LADDER,
  KeyboardHelp,
  MeasurePanel,
  ObjectBrowser,
  ObjectInspector,
  OpsPanel,
  PanelContainer,
  ReadoutPanel,
  SearchBox,
  severityFor,
  SettingsPanel,
  ThemeToggle,
  TimelineControls,
  Tooltip,
  ViewControls,
  useKeyboardShortcuts,
  type CatalogSample,
  type KeyboardAction,
} from '@bessel/ui';
import { createAppStore, useStore, type AppStore } from './store/index.ts';
import { useBesselEngine } from './engine/index.ts';
import { createMissionRegistry } from './missions.ts';
import { AppShell, resolvePanel, pluginPanelIds } from './shell/index.ts';
import { Popover } from './overlays/Popover.tsx';
// Heavy workbench and menu panels are code-split: each loads on demand the first time
// its menu opens (the Popover mounts its children only while open), keeping the analysis
// engines and charting out of the first-paint chunk. PanelSuspense supplies the
// accessible loading fallback while a panel's chunk loads.
import {
  AnalysisPanel,
  MissionPanel,
  OdPanel,
  PanelSuspense,
  PropagatePanel,
  ReportPanel,
  ScriptConsole,
  TelemetryOverlay,
} from './panels/lazy.tsx';

const SPICE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  SOLAR_SYSTEM.map((p) => [p.name, p.spiceId]),
);

/** A bundled, recognizable sample mission offered as a one-click load in the Mission
 *  menu. Resolved under the deploy base path so it works on the GitHub Pages subpath. */
const SAMPLE_CATALOGS: readonly CatalogSample[] = [
  { label: 'Cassini at Saturn', url: `${import.meta.env.BASE_URL}samples/cassini-saturn.json` },
];

/** A selene StatusDot tone for the status HUD, derived purely from existing app
 *  state. The visible status text is unchanged; the dot only adds a color cue. */
function hudTone(status: string, fault: string | null, residualKm: number | null): StatusTone {
  if (status.startsWith('Error')) return 'fault';
  if (fault != null) return 'critical';
  if (residualKm != null && residualKm >= DEFAULT_LADDER.critical) return 'critical';
  if (status === 'Ready') return 'nominal';
  return 'caution';
}

/** Collapse the telemetry severity ladder onto a StatusDot tone for the HUD residual. */
function toneForHud(severity: ReturnType<typeof severityFor>): StatusTone {
  if (severity === 'critical' || severity === 'severe') return 'critical';
  if (severity === 'distress') return 'fault';
  if (severity === 'watch' || severity === 'warning') return 'caution';
  return 'nominal';
}

/** The HUD residual readout: a short text and its tone, or a "sample data" note when
 *  there is no live telemetry. Reuses the @bessel/ui ladder so the word matches the
 *  Telemetry overlay. */
function hudResidual(
  residualKm: number | null,
  fault: string | null,
): { readonly text: string; readonly tone: StatusTone } {
  if (fault != null) return { text: `fault: ${fault}`, tone: 'fault' };
  if (residualKm == null) return { text: 'sample data', tone: 'nominal' };
  const severity = severityFor(residualKm, DEFAULT_LADDER);
  return { text: `RES ${residualKm.toFixed(2)} km (${severity})`, tone: toneForHud(severity) };
}

export function BesselViewer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) storeRef.current = createAppStore();
  const store = storeRef.current;
  const engine = useBesselEngine(canvasRef, store);
  const [query, setQuery] = useState('');
  const [scriptSource, setScriptSource] = useState('gotoObject Earth\nsetTimeRate 3600');
  const [scriptLog, setScriptLog] = useState<readonly string[]>([]);
  const [shareNote, setShareNote] = useState<{ url: string; copied: boolean } | null>(null);
  const [bookmarkImportError, setBookmarkImportError] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);

  // Surface a transient "view link copied" confirmation, or the link in a selectable
  // field when the clipboard was unavailable (so the link is never silently lost).
  const showShare = useCallback((r: { url: string; copied: boolean } | null): void => {
    if (!r) return;
    setShareNote(r);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    if (r.copied) noteTimer.current = window.setTimeout(() => setShareNote(null), 4000);
  }, []);

  const runScript = useCallback((): void => {
    if (!engine) return;
    const result = engine.runScript(scriptSource);
    const lines = [...result.echoLines];
    if (result.error) lines.push(`error on line ${result.error.line}: ${result.error.message}`);
    setScriptLog(lines.length ? lines : ['(no verbs to run)']);
  }, [engine, scriptSource]);

  const status = useStore(store, (s) => s.status);
  const ready = useStore(store, (s) => s.ready);
  const playing = useStore(store, (s) => s.playing);
  const rate = useStore(store, (s) => s.rate);
  const et = useStore(store, (s) => s.et);
  const bounds = useStore(store, (s) => s.bounds);
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const timeSystem = useStore(store, (s) => s.timeSystem);
  const focus = useStore(store, (s) => s.focus);
  const instruments = useStore(store, (s) => s.instruments);
  const footprintPoints = useStore(store, (s) => s.footprintPoints);
  const fovOk = useStore(store, (s) => s.fovOk);
  const ringTextured = useStore(store, (s) => s.ringTextured);
  const cloudShell = useStore(store, (s) => s.cloudShell);
  const selection = useStore(store, (s) => s.selection);
  const track = useStore(store, (s) => s.track);
  const cameraMode = useStore(store, (s) => s.cameraMode);
  const cameraFrame = useStore(store, (s) => s.cameraFrame);
  const realImageryApplied = useStore(store, (s) => s.realImageryApplied);
  const settings = useStore(store, (s) => s.settings);
  const visibility = useStore(store, (s) => s.visibility);
  const readouts = useStore(store, (s) => s.readouts);
  const helpOpen = useStore(store, (s) => s.helpOpen);
  const recording = useStore(store, (s) => s.recording);
  const theme = useStore(store, (s) => s.theme);
  const telemetryResidualKm = useStore(store, (s) => s.telemetryResidualKm);
  const telemetryOverlay = useStore(store, (s) => s.telemetryOverlay);
  const telemetryFault = useStore(store, (s) => s.telemetryFault);
  const statusTone = hudTone(status, telemetryFault, telemetryResidualKm);
  const residual = hudResidual(telemetryResidualKm, telemetryFault);
  const missionAnnotations = useStore(store, (s) => s.annotations);
  const spacecraftQuat = useStore(store, (s) => s.spacecraftQuat);
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

  // The bundled missions come from the plugin registry (surfacing it in the shell).
  const registryRef = useRef(createMissionRegistry());
  const missions = useMemo(
    () => registryRef.current.list().map((p) => ({ id: p.id, name: p.name })),
    [],
  );
  // The shell resolves the plugin-declared panel ids to concrete components; the
  // registry stays UI-free. The Plugins panel appears when any plugin contributes it.
  const PluginPanel = useMemo(() => {
    const ids = pluginPanelIds(registryRef.current.list());
    for (const id of ids) {
      const component = resolvePanel(id);
      if (component) return component;
    }
    return null;
  }, []);

  const focusEntry = objects.find((e) => e.id === focus);
  const inspectorFields = [{ label: 'SPICE id', value: SPICE_IDS[focus] ?? '-' }];

  // Spacecraft-only chrome (instrument and tracking controls, mission event
  // markers) appears only once a mission with a spacecraft is loaded, so the
  // default solar-system view stays uncluttered.
  const hasSpacecraft = objects.some((e) => e.kind === 'spacecraft');

  // Timeline annotations are computed in the engine/mission layer (where SPICE
  // lives) from arc boundaries plus a SPICE-found closest approach, and arrive
  // here as inert data (the dependency rule). No hard-coded markers.
  const annotations = missionAnnotations;

  const actions = (
    <>
      <Popover label="Mission" title="Mission and operations" align="right" testId="mission-menu">
        <CatalogLoader
          onLoad={(file) => void engine?.loadCatalog(file)}
          status={loadedName ? `Loaded ${loadedName}: ${objects.length} objects` : null}
          error={loadError}
          samples={SAMPLE_CATALOGS}
          onLoadSample={(url) => void engine?.loadCatalogUrl(url)}
          onLoadUrl={(url) => void engine?.loadCatalogUrl(url)}
        />
        <div className="bessel-menu-section" data-testid="panel-ops">
          <OpsPanel
            missions={missions}
            onLoadMission={(id) => void engine?.loadMission(registryRef.current, id)}
            onRunTour={() => engine?.runTour()}
          />
        </div>
      </Popover>
      {PluginPanel ? (
        <Popover label="Plugins" title="Mission plugins" align="right" testId="plugins-menu">
          <PanelSuspense>
            <PluginPanel engine={engine} store={store} registry={registryRef.current} />
          </PanelSuspense>
        </Popover>
      ) : null}
      <Popover label="Capture" title="Capture" align="right" testId="capture-menu">
        <CaptureControls
          recording={recording}
          onCaptureStill={() => engine?.captureStill()}
          onToggleRecording={() => engine?.toggleRecording()}
        />
      </Popover>
      <Popover label="Script" title="Scripting console" align="right" testId="script-menu">
        <PanelSuspense>
          <ScriptConsole
            source={scriptSource}
            onChange={setScriptSource}
            onRun={runScript}
            log={scriptLog}
          />
        </PanelSuspense>
      </Popover>
      <Popover label="Propagate" title="Orbit propagation" align="right" testId="propagate-menu">
        <PanelSuspense>
          <PropagatePanel engine={engine} store={store} />
        </PanelSuspense>
      </Popover>
      <Popover label="Mission Design" title="Mission design (MCS)" align="right" testId="mission-design-menu">
        <PanelSuspense>
          <MissionPanel engine={engine} store={store} />
        </PanelSuspense>
      </Popover>
      <Popover label="OD" title="Orbit determination" align="right" testId="od-menu">
        <PanelSuspense>
          <OdPanel engine={engine} store={store} />
        </PanelSuspense>
      </Popover>
      <Popover label="Report" title="Data-provider workbench" align="right" testId="report-menu">
        <PanelSuspense>
          <ReportPanel engine={engine} store={store} />
        </PanelSuspense>
      </Popover>
      <Popover label="Views" title="Saved views" align="right" testId="views-menu">
        <BookmarksPanel
          bookmarks={bookmarks}
          onSave={(name) => void engine?.saveBookmark(name)}
          onApply={(id) => void engine?.applyBookmark(id)}
          onDelete={(id) => void engine?.deleteBookmark(id)}
          onCopyLink={(id) => void engine?.copyBookmarkLink(id).then(showShare)}
          onExport={() => engine?.exportBookmarks()}
          onImport={(text) => {
            setBookmarkImportError(null);
            void Promise.resolve()
              .then(() => engine?.importBookmarks(text))
              .catch((err: unknown) =>
                setBookmarkImportError(err instanceof Error ? err.message : String(err)),
              );
          }}
          importError={bookmarkImportError}
        />
      </Popover>
      <Popover label="Analysis" title="Analysis" align="right" testId="analysis-menu">
        <PanelSuspense>
          <AnalysisPanel engine={engine} store={store} hasSpacecraft={hasSpacecraft} />
        </PanelSuspense>
      </Popover>
      <Popover label="Telemetry" title="Predicted versus actual" align="right" testId="telemetry-menu">
        <PanelSuspense>
          {!hasSpacecraft ? (
            <p className="bessel-loader-hint" data-testid="telemetry-empty-notice">
              Load a spacecraft to analyze.
            </p>
          ) : null}
          <TelemetryOverlay series={telemetryOverlay} nowEt={et} fault={telemetryFault} />
        </PanelSuspense>
      </Popover>
      <Tooltip label="Toggle light / dark theme">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </Tooltip>
    </>
  );

  const left = (
    <PanelContainer title="Objects" testId="panel-objects">
      <SearchBox value={query} onChange={setQuery} placeholder="Filter objects" />
      <ViewControls
        onViewTopDown={() => engine?.viewTopDown()}
        onViewFromSun={() => engine?.viewFromSun()}
        onViewAlongVelocity={hasSpacecraft ? () => engine?.viewAlongVelocity() : undefined}
        mode={cameraMode}
        onMode={(m) => engine?.setCameraMode(m)}
      />
      <CameraFrameControls
        frame={cameraFrame}
        frameMode={cameraMode === 'frame'}
        onFrame={(f) => engine?.setCameraFrame(f)}
        onDolly={(forward) => engine?.dolly(forward)}
        onCrane={(up) => engine?.crane(up)}
      />
      <ObjectBrowser
        entries={filteredEntries}
        focus={focus}
        selection={selection}
        visibility={visibility}
        onToggleSelect={(id) => engine?.toggleSelectObject(id)}
        onToggleVisible={(id, visible) => engine?.toggleVisibleObject(id, visible)}
        onCenter={(id) => engine?.centerOn(id)}
      />
    </PanelContainer>
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
        data-ring-textured={ringTextured ? 'true' : 'false'}
        data-real-imagery={realImageryApplied ? 'true' : 'false'}
        {...(cloudShell ? { 'data-cloud-shell': 'true' } : {})}
        data-cam-target={focus}
        data-cam-mode={track ? 'track' : cameraMode}
        data-selection={selection.join(',')}
        data-epoch={epochLabel}
        data-time-system={timeSystem}
        data-sc-quat={spacecraftQuat ? spacecraftQuat.map((v) => v.toFixed(4)).join(',') : ''}
        data-testid="viewport"
      />
      <div className="bessel-hud" role="status" aria-label="Operations status">
        <span className="bessel-hud-cell">
          <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
            <StatusDot tone={statusTone} halo={statusTone === 'critical'} />
          </span>
          <span className="bessel-hud-status" data-testid="status">
            {status}
          </span>
        </span>
        {hasSpacecraft ? (
          <>
            <span className="bessel-hud-sep" aria-hidden="true" />
            <span className="bessel-hud-cell">
              <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                <StatusDot tone={residual.tone} />
              </span>
              <span className="bessel-hud-residual" data-testid="hud-residual" data-severity={residual.tone}>
                {residual.text}
              </span>
            </span>
            <span className="bessel-hud-sep" aria-hidden="true" />
            <span className="bessel-hud-track" data-testid="hud-track">
              {focus}
            </span>
          </>
        ) : null}
      </div>
      <div className="bessel-viewcontrols" role="group" aria-label="Instruments and sharing">
        {hasSpacecraft && (
          <>
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
          </>
        )}
        <button type="button" onClick={() => void engine?.share().then(showShare)} data-testid="share">
          Share view
        </button>
        {shareNote ? (
          shareNote.copied ? (
            <span className="bessel-share-note" role="status" data-testid="share-confirm">
              View link copied
            </span>
          ) : (
            <input
              className="bessel-share-fallback"
              data-testid="share-url"
              readOnly
              value={shareNote.url}
              aria-label="Shareable view link"
              onFocus={(e) => e.currentTarget.select()}
            />
          )
        ) : null}
        <span className="bessel-selection" data-testid="selection-label">
          {selection.length ? `Selected: ${selection.join(', ')}` : 'No selection'}
        </span>
      </div>
      <div className="bessel-canvas-topright">
        <Popover label="Layers" title="Visualization layers" align="right" testId="layers-popover">
          <SettingsPanel settings={settings} onChange={(k, v) => engine?.setSetting(k, v)} />
        </Popover>
        <button
          type="button"
          className="bessel-help-button"
          onClick={() => engine?.setHelpOpen(true)}
          aria-label="Keyboard shortcuts help"
          data-testid="help-button"
        >
          ?
        </button>
      </div>
      <KeyboardHelp open={helpOpen} onClose={() => engine?.setHelpOpen(false)} />
      {selection.length > 0 ? (
        <aside
          className="bessel-inspector-card"
          aria-label="Selection details"
          data-testid="inspector-card"
        >
          <ObjectInspector name={focus} kind={focusEntry?.kind} fields={inspectorFields} />
          <ReadoutPanel target={focus} readouts={readouts} />
          <MeasurePanel
            from={measurement?.from ?? null}
            to={measurement?.to ?? null}
            distanceKm={measurement?.distanceKm ?? null}
            relativeSpeedKmS={measurement?.relativeSpeedKmS ?? null}
            angleDeg={measurement?.angleDeg ?? null}
          />
        </aside>
      ) : null}
    </div>
  );

  const bottom = (
    <TimelineControls
      playing={playing}
      rate={rate}
      epochLabel={epochLabel}
      timeSystem={timeSystem}
      min={bounds[0]}
      max={bounds[1]}
      value={et}
      annotations={annotations}
      onPlayToggle={() => engine?.togglePlay()}
      onRateChange={(r) => engine?.setRate(r)}
      onScrub={(v) => engine?.scrub(v)}
      onTimeSystemChange={(s) => engine?.setTimeSystem(s)}
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
      bottom={bottom}
    />
  );
}
