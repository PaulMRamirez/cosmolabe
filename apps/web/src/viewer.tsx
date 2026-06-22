// The mission viewer on the modern shell. It owns the state store and
// the BesselEngine, subscribes to store slices, and lays its controls out into
// the app shell's dock regions: objects on the left, the viewport in the center,
// tools on the right, the timeline along the bottom. The component stays
// presentational; all imperative work lives in the engine.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SOLAR_SYSTEM } from '@bessel/scene';
import { StatusDot, Icon, Button, type StatusTone } from '@bessel/selene-design';
import { sortByEt } from '@bessel/timeline';
import {
  BookmarksPanel,
  CameraFrameControls,
  CaptureControls,
  CatalogLoader,
  CloseButton,
  DEFAULT_LADDER,
  FaultBanner,
  KeyboardHelp,
  LiveGeometryReadout,
  MeasurePanel,
  StateVectorPanel,
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
  WelcomeCard,
  useKeyboardShortcuts,
  type CatalogSample,
  type KeyboardAction,
} from '@bessel/ui';
import { createAppStore, useStore, type AppStore } from './store/index.ts';
import { SCRIPT_VERBS } from './script-runner.ts';
import { useBesselEngine } from './engine/index.ts';
import { createMissionRegistry } from './missions.ts';
import { AppShell, resolvePanel, pluginPanelIds, useMediaQuery, NARROW_MEDIA_QUERY } from './shell/index.ts';
import { Popover } from './overlays/Popover.tsx';
// Heavy workbench and menu panels are code-split: each loads on demand the first time
// its menu opens (the Popover mounts its children only while open), keeping the analysis
// engines and charting out of the first-paint chunk. PanelSuspense supplies the
// accessible loading fallback while a panel's chunk loads.
import { PanelSuspense, ScriptConsole } from './panels/lazy.tsx';
// The six former analysis popovers are consolidated into one pinnable dock; its tab
// bodies stay lazy (imported from panels/lazy.tsx inside AnalyzeWorkbench).
import { AnalyzeWorkbench } from './panels/AnalyzeWorkbench.tsx';

const SPICE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  SOLAR_SYSTEM.map((p) => [p.name, p.spiceId]),
);

/** A bundled, recognizable sample mission offered as a one-click load in the Mission
 *  menu. Resolved under the deploy base path so it works on the GitHub Pages subpath. */
const SAMPLE_CATALOGS: readonly CatalogSample[] = [
  { label: 'Cassini at Saturn', url: `${import.meta.env.BASE_URL}samples/cassini-saturn.json` },
];

/** A compact T-minus string for a future event (always positive). */
function formatTMinus(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

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
    const run = lines.length ? lines : ['(no verbs to run)'];
    // Accumulate a run-log: a divider then this run's echo, keeping the tail bounded
    // so a long session does not grow the DOM without limit.
    setScriptLog((prev) => [...prev, '--- run ---', ...run].slice(-200));
  }, [engine, scriptSource]);

  const loadSavedScript = useCallback(
    (name: string): void => {
      const found = store.getState().savedScripts.find((s) => s.name === name);
      if (found) setScriptSource(found.source);
    },
    [store],
  );

  const status = useStore(store, (s) => s.status);
  const ready = useStore(store, (s) => s.ready);
  const playing = useStore(store, (s) => s.playing);
  const rate = useStore(store, (s) => s.rate);
  const et = useStore(store, (s) => s.et);
  const bounds = useStore(store, (s) => s.bounds);
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const boundsLabel = useStore(store, (s) => s.boundsLabel);
  const timeSystem = useStore(store, (s) => s.timeSystem);
  const analyzeOpen = useStore(store, (s) => s.analyzeOpen);
  const analyzeTab = useStore(store, (s) => s.analyzeTab);
  const timelineError = useStore(store, (s) => s.timelineError);
  const focus = useStore(store, (s) => s.focus);
  const instruments = useStore(store, (s) => s.instruments);
  const activeInstrumentId = useStore(store, (s) => s.activeInstrumentId);
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
  const showLiveGeometry = useStore(store, (s) => s.showLiveGeometry);
  const visibility = useStore(store, (s) => s.visibility);
  const readouts = useStore(store, (s) => s.readouts);
  const bodyState = useStore(store, (s) => s.bodyState);
  const stateFrame = useStore(store, (s) => s.stateFrame);
  const helpOpen = useStore(store, (s) => s.helpOpen);
  const recording = useStore(store, (s) => s.recording);
  const theme = useStore(store, (s) => s.theme);
  const telemetryResidualKm = useStore(store, (s) => s.telemetryResidualKm);
  const telemetryOverlay = useStore(store, (s) => s.telemetryOverlay);
  const telemetryFault = useStore(store, (s) => s.telemetryFault);
  const acknowledgedFault = useStore(store, (s) => s.acknowledgedFault);
  const statusTone = hudTone(status, telemetryFault, telemetryResidualKm);
  const residual = hudResidual(telemetryResidualKm, telemetryFault);
  const missionAnnotations = useStore(store, (s) => s.annotations);
  const spacecraftQuat = useStore(store, (s) => s.spacecraftQuat);
  const objects = useStore(store, (s) => s.objects);
  const loadedName = useStore(store, (s) => s.loadedName);
  const loadError = useStore(store, (s) => s.loadError);
  const welcomeSeen = useStore(store, (s) => s.welcomeSeen);
  const measurement = useStore(store, (s) => s.measurement);
  const measureMode = useStore(store, (s) => s.measureMode);
  const bookmarks = useStore(store, (s) => s.bookmarks);
  const savedScripts = useStore(store, (s) => s.savedScripts);

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
  // The live geometry readout stays visible through a pass (independent of selection)
  // whenever tracking is on or the spacecraft itself is the focus.
  const focusIsSpacecraft = focusEntry?.kind === 'spacecraft';
  const showLiveReadout = hasSpacecraft && (track || focusIsSpacecraft) && showLiveGeometry;

  // Timeline annotations are computed in the engine/mission layer (where SPICE
  // lives) from arc boundaries plus a SPICE-found closest approach, and arrive
  // here as inert data (the dependency rule). No hard-coded markers.
  const annotations = missionAnnotations;
  // The next upcoming event + a live T-minus, derived from the current epoch and the
  // sorted annotations (recomputes on every et tick, so it counts down during playback).
  const nextEvent = useMemo(() => {
    const future = sortByEt(annotations).find((a) => a.et > et);
    return future ? { label: future.label, tMinus: formatTMinus(future.et - et) } : null;
  }, [annotations, et]);

  const narrowChrome = useMediaQuery(NARROW_MEDIA_QUERY);

  const missionMenu = (
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
  );

  const pluginsMenu = PluginPanel ? (
    <Popover label="Plugins" title="Mission plugins" align="right" testId="plugins-menu">
      <PanelSuspense>
        <PluginPanel engine={engine} store={store} registry={registryRef.current} />
      </PanelSuspense>
    </Popover>
  ) : null;


  const scriptMenu = (
    <Popover label="Script" title="Scripting console" align="right" testId="script-menu" pinnable>
      <PanelSuspense>
        <ScriptConsole
          source={scriptSource}
          onChange={setScriptSource}
          onRun={runScript}
          log={scriptLog}
          onClearLog={() => setScriptLog([])}
          verbs={SCRIPT_VERBS}
          savedScriptNames={savedScripts.map((s) => s.name)}
          onSave={(name) => void engine?.saveScript(name, scriptSource)}
          onLoadSaved={loadSavedScript}
          onDeleteSaved={(name) => void engine?.deleteScript(name)}
        />
      </PanelSuspense>
    </Popover>
  );

  const analyzeButton = (
    <button
      type="button"
      className="bessel-popover-trigger"
      data-testid="analyze-toggle"
      aria-expanded={analyzeOpen}
      aria-pressed={analyzeOpen}
      onClick={() => engine?.toggleAnalyze()}
    >
      Analyze
    </button>
  );

  const viewsMenu = (
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
  );

  const layersMenu = (
    <Popover
      label={<Icon name="settings" />}
      ariaLabel="Visualization settings"
      title="Visualization layers"
      align="right"
      testId="layers-popover"
    >
      <SettingsPanel
        settings={settings}
        onChange={(k, v) => engine?.setSetting(k, v)}
        onReset={() => engine?.resetSettings()}
        showLiveGeometry={showLiveGeometry}
        onToggleLiveGeometry={(v) => engine?.setShowLiveGeometry(v)}
      />
    </Popover>
  );

  const themeToggle = (
    <Tooltip label="Toggle light / dark theme">
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </Tooltip>
  );

  // On a narrow viewport the menu-heavy actions collapse behind a single "More"
  // overflow popover, keeping the bar from clipping; Analyze and the theme toggle
  // (the two most-reached controls) stay inline. Desktop renders them flat as before.
  const actions = narrowChrome ? (
    <>
      {analyzeButton}
      <Popover label="More" title="More actions" align="right" testId="more-menu">
        <div className="bessel-appbar-overflow">
          {missionMenu}
          {pluginsMenu}
          {scriptMenu}
          {viewsMenu}
        </div>
      </Popover>
      {layersMenu}
      {themeToggle}
    </>
  ) : (
    <>
      {missionMenu}
      {pluginsMenu}
      {scriptMenu}
      {analyzeButton}
      {viewsMenu}
      {layersMenu}
      {themeToggle}
    </>
  );

  const left = (
    <>
      <PanelContainer title="Objects" testId="panel-objects">
        <SearchBox value={query} onChange={setQuery} placeholder="Filter objects" />
        <ObjectBrowser
          entries={filteredEntries}
          focus={focus}
          selection={selection}
          visibility={visibility}
          onToggleSelect={(id) => engine?.toggleSelectObject(id)}
          onToggleVisible={(id, visible) => engine?.toggleVisibleObject(id, visible)}
          onCenter={(id) => engine?.centerOn(id)}
          onToggleTrack={() => engine?.toggleTrack()}
          tracking={track}
          instrumentLayer={{
            isShown: (id) => instruments && activeInstrumentId === id,
            onToggle: (id) => {
              if (instruments && activeInstrumentId === id) {
                engine?.toggleInstruments();
              } else {
                if (activeInstrumentId !== id) void engine?.setActiveInstrument(id);
                if (!instruments) engine?.toggleInstruments();
              }
            },
            fovOn: settings.fov,
            footprintOn: settings.footprint,
            onToggleFov: () => engine?.setSetting('fov', !settings.fov),
            onToggleFootprint: () => engine?.setSetting('footprint', !settings.footprint),
          }}
        />
      </PanelContainer>
      {selection.length > 0 || measureMode ? (
        <PanelContainer title="Selection" testId="inspector-card">
          <div className="bessel-inspector-actions">
            <CloseButton
              onClose={() => engine?.closeInspector()}
              label="Close selection details"
              testId="inspector-close"
            />
          </div>
          <ObjectInspector name={focus} kind={focusEntry?.kind} fields={inspectorFields} />
          <ReadoutPanel target={focus} readouts={readouts} />
          <MeasurePanel
            from={measurement?.from ?? null}
            to={measurement?.to ?? null}
            distanceKm={measurement?.distanceKm ?? null}
            relativeSpeedKmS={measurement?.relativeSpeedKmS ?? null}
            angleDeg={measurement?.angleDeg ?? null}
            measureMode={measureMode}
            onToggleMode={() => engine?.toggleMeasureMode()}
            onClear={() => engine?.clearSelection()}
            hasSelection={selection.length > 0}
          />
          <StateVectorPanel
            target={focus}
            state={bodyState}
            frame={stateFrame}
            onFrameChange={(f) => engine?.setStateFrame(f)}
          />
        </PanelContainer>
      ) : null}
      <PanelContainer title="Camera" testId="panel-camera" defaultCollapsed>
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
          onFrame={(f) => {
            engine?.setCameraFrame(f);
            if (cameraMode !== 'frame') engine?.setCameraMode('frame');
          }}
          onDolly={(forward) => engine?.dolly(forward)}
          onCrane={(up) => engine?.crane(up)}
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
              <button
                type="button"
                className="bessel-hud-residual bessel-hud-residual-link"
                data-testid="hud-residual"
                data-severity={residual.tone}
                onClick={() => engine?.setAnalyzeTab('report-compare')}
                title="Open the telemetry overlay"
                aria-label={`Telemetry residual ${residual.text}. Open the telemetry overlay.`}
              >
                {residual.text}
              </button>
            </span>
            <span className="bessel-hud-sep" aria-hidden="true" />
            <span className="bessel-hud-track" data-testid="hud-track">
              {focus}
            </span>
          </>
        ) : null}
      </div>
      {/* View tools (share / screenshot / record), a vertical strip under the status
          HUD, replacing the top-bar Capture menu and the floating share button. */}
      <div className="bessel-canvas-tools" role="group" aria-label="View tools">
        <Tooltip label="Share view">
          <Button
            iconOnly
            variant="secondary"
            ariaLabel="Share view"
            testId="share"
            onClick={() => void engine?.share().then(showShare)}
          >
            <Icon name="share" />
          </Button>
        </Tooltip>
        <CaptureControls
          recording={recording}
          onCaptureStill={() => engine?.captureStill()}
          onToggleRecording={() => engine?.toggleRecording()}
        />
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
      </div>
      {/* Always-mounted telemetry fault alert: a fault reaches the operator with no
          menu open. Renders nothing (no role/contrast surface) when nominal. */}
      <div className="bessel-fault-chrome">
        <FaultBanner
          fault={telemetryFault && telemetryFault !== acknowledgedFault ? telemetryFault : null}
          onAcknowledge={() => engine?.acknowledgeFault()}
          testId="telemetry-fault-alert"
        />
      </div>
      <div className="bessel-canvas-topright">
        <Tooltip label="Keyboard shortcuts and help (press ?)">
          <button
            type="button"
            className="bessel-help-button"
            onClick={() => engine?.setHelpOpen(true)}
            aria-label="Keyboard shortcuts help"
            data-testid="help-button"
          >
            <Icon name="help" />
          </button>
        </Tooltip>
      </div>
      <KeyboardHelp open={helpOpen} onClose={() => engine?.setHelpOpen(false)} />
      {/* Always-visible geometry, bound to the tracked/focused object, so a canvas
          click that clears the selection does not blank the live numbers. */}
      {showLiveReadout ? (
        <LiveGeometryReadout
          target={focus}
          readouts={readouts}
          onDismiss={() => engine?.setShowLiveGeometry(false)}
        />
      ) : null}
      {!loadedName && !welcomeSeen ? (
        <WelcomeCard
          onLoadSample={() => void engine?.loadSampleMission(SAMPLE_CATALOGS[0]!.url)}
          onTour={() => {
            void engine?.dismissWelcome();
            engine?.runTour();
          }}
          onExplore={() => void engine?.dismissWelcome()}
          onClose={() => void engine?.dismissWelcome()}
        />
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
      minLabel={boundsLabel?.[0] ?? null}
      maxLabel={boundsLabel?.[1] ?? null}
      annotations={annotations}
      nextEventLabel={nextEvent?.label ?? null}
      nextEventTMinus={nextEvent?.tMinus ?? null}
      onPlayToggle={() => engine?.togglePlay()}
      onRateChange={(r) => engine?.setRate(r)}
      onScrub={(v) => engine?.scrub(v)}
      onTimeSystemChange={(s) => engine?.setTimeSystem(s)}
      onGoToEpoch={(t) => void engine?.goToEpoch(t)}
      goToEpochError={timelineError}
      onAnnotationSelect={(v) => engine?.scrub(v)}
    />
  );

  // The Analyze dock fills the AppShell 'right' slot when open; closed, the canvas
  // reclaims the width. It stays mounted while open (no auto-dismiss).
  const right = analyzeOpen ? (
    <AnalyzeWorkbench
      engine={engine}
      store={store}
      hasSpacecraft={hasSpacecraft}
      activeTab={analyzeTab}
      onTab={(t) => engine?.setAnalyzeTab(t)}
      onClose={() => engine?.toggleAnalyze()}
      telemetryOverlay={telemetryOverlay}
      et={et}
      telemetryFault={telemetryFault}
    />
  ) : undefined;

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
