// BesselEngine owns the imperative side of the viewer: the camera-relative scene,
// the clock, the SPICE worker client, and the requestAnimationFrame loop. The
// loop reads live UI state straight from the store (playing, rate, track,
// instruments) instead of the mirror refs the monolithic viewer carried, and
// writes derived state (et, epochLabel, readouts, footprint count) back to it.
// React subscribes to the store; user actions call the methods below.

import {
  pointerToNdc,
  buildScene,
  azimuthElevationFromDirection,
  uniformRotationQuaternion,
  type Km3,
} from '@bessel/scene';
import {
  captureStill,
  downloadBlob,
  startRecording,
  type KeyboardAction,
  type Recorder,
  type SettingKey,
} from '@bessel/ui';
import { encodeView, decodeView, TelemetryAdapter, type ViewModel } from '@bessel/state';
import type { PluginRegistry, BesselCatalog } from '@bessel/catalog';
import { positionAt, velocityAt, rangeRate } from '../sampler.ts';
import { fovRim, footprint } from '../instruments.ts';
import { toggleSelection } from '../selection.ts';
import { parseAnyCatalog, nativeEntries, formatLoadError } from '../catalog-load.ts';
import { buildCatalogMissionScene } from '../generic-mission.ts';
import { createScript } from '../scripting.ts';
import { MockTelemetrySocket } from '../telemetry-mock.ts';
import {
  loadBookmarks,
  persistBookmarks,
  newBookmarkId,
  type Bookmark,
} from '../bookmarks.ts';
import type { AppStore } from '../store/index.ts';
import { bootScene, loadInstrument, type EngineCore } from './bootstrap.ts';
import { applyViewModel } from './apply-view.ts';

// True when two optional angles are equal or both absent (within tolerance).
function anglesClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}
import { pushEpochLabel, pushReadouts } from './telemetry.ts';
import { FOCUS_DISTANCE, DEFAULT_FOCUS_DISTANCE, RATE_STEPS } from './constants.ts';

export class BesselEngine {
  private core: EngineCore | null = null;
  private raf = 0;
  private lastTs = 0;
  private labelAccum = 0;
  private instrumentAccum = 0;
  private readoutAccum = 0;
  private attitudeAccum = 0;
  private telemetryAccum = 0;
  private telemetry: { socket: MockTelemetrySocket; adapter: TelemetryAdapter } | null = null;
  private recorder: Recorder | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: AppStore,
  ) {}

  private readonly isDisposed = (): boolean => this.disposed;

  async boot(): Promise<void> {
    try {
      this.core = await bootScene(this.canvas, this.store, this.isDisposed);
      if (this.disposed) return;
      // Apply the canvas's real CSS size now that the scene exists. The
      // ResizeObserver fires before boot completes (when there is no scene to
      // resize), so without this the renderer, camera aspect, and label layer
      // stay at the canvas width/height attributes and the scene is stretched.
      const cssW = this.canvas.clientWidth;
      const cssH = this.canvas.clientHeight;
      if (cssW > 0 && cssH > 0) this.resize(cssW, cssH);
      this.raf = requestAnimationFrame(this.frame);
      this.store.setState({ status: 'Ready', ready: true });
      void this.loadBookmarksFromStorage();
    } catch (err) {
      if (!this.disposed) {
        this.store.setState({
          status: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTelemetry();
    if (this.core) {
      cancelAnimationFrame(this.raf);
      this.core.scene.dispose();
    }
    this.core = null;
  }

  // Match the renderer drawing buffer to the canvas CSS size as the dock resizes.
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.core?.scene.resize(width, height);
  }

  private readonly frame = (ts: number): void => {
    const e = this.core;
    if (!e) return;
    const s = this.store.getState();
    const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs = ts;
    e.clock.setRate(s.rate);
    if (s.playing) e.clock.play();
    else e.clock.pause();
    e.clock.tick(dt);
    const now = e.clock.state.et;

    const positions = new Map<string, Km3>();
    for (const name of e.table.byBody.keys()) {
      positions.set(name, positionAt(e.table, name, now));
    }
    e.scene.setPositions(positions);
    e.scene.updateTimeSwitched(now);

    // Track-along-trajectory camera: follow the mission spacecraft down its velocity.
    const scName = e.identity.spacecraftName;
    if (s.track && scName) {
      e.scene.setFocusVelocity(velocityAt(e.table, scName, now));
      e.scene.setCameraMode('track');
    } else {
      e.scene.setCameraMode('orbit');
    }

    // Sensor FOV cone (cheap, every frame) and footprint (throttled, async). Only
    // a mission that declares an instrument (e.g. the Cassini sample) has one.
    if (s.instruments && e.instrument && scName) {
      const inst = e.instrument;
      const anchor = inst.descriptor.anchorName;
      const scPos = positionAt(e.table, scName, now);
      const targetPos = positionAt(e.table, anchor, now);
      e.scene.setFovCone(scPos, fovRim(scPos, targetPos, inst.fov));
      this.instrumentAccum += dt;
      if (this.instrumentAccum > 0.4) {
        this.instrumentAccum = 0;
        void footprint(e.spice, now, inst.fov, inst.descriptor).then(
          (pts) => {
            if (!this.disposed && this.store.getState().instruments) {
              e.scene.setFootprint(pts, anchor, '#ff33cc');
              this.store.setState({ footprintPoints: pts.length });
            }
          },
          (err: unknown) => console.error('footprint failed', err),
        );
      }
    }

    // Spacecraft attitude from the catalog: a fixed quaternion, a uniform spin
    // (both cheap, every frame), or a SPICE/CK frame (a worker round-trip, so
    // throttled; when no CK covers the epoch pxform fails and the model keeps its
    // last orientation).
    const att = e.identity.attitude;
    if (att?.kind === 'fixed') {
      e.scene.setSpacecraftAttitudeQuaternion(att.quaternion);
    } else if (att?.kind === 'uniform') {
      e.scene.setSpacecraftAttitudeQuaternion(
        uniformRotationQuaternion(att.axis, att.ratePerSec, now, att.epochEt),
      );
    } else if (att?.kind === 'spice') {
      this.attitudeAccum += dt;
      if (this.attitudeAccum > 0.2) {
        this.attitudeAccum = 0;
        const frame = att.frame;
        void e.spice.pxform(frame, 'J2000', now).then(
          (rot) => {
            if (!this.disposed) e.scene.setSpacecraftAttitude(rot);
          },
          () => {
            // No CK coverage at this epoch; leave the model orientation unchanged.
          },
        );
      }
    }

    e.scene.render();

    if (s.playing) this.store.setState({ et: now });
    this.labelAccum += dt;
    if (this.labelAccum > 0.25) {
      this.labelAccum = 0;
      pushEpochLabel(e.spice, this.store, now, this.isDisposed);
    }
    this.readoutAccum += dt;
    if (this.readoutAccum > 0.3) {
      this.readoutAccum = 0;
      const focus = e.scene.focusBody;
      const observer = focus === e.identity.spacecraftName ? null : (e.identity.spacecraftId ?? null);
      pushReadouts(e.spice, this.store, focus, observer, now, this.isDisposed);
      this.updateMeasurement(now);
    }
    // Mock telemetry: emit a synthetic "actual" near the predicted position and
    // publish the latest predicted-versus-actual residual.
    this.telemetryAccum += dt;
    if (this.telemetry && this.telemetryAccum > 0.5) {
      this.telemetryAccum = 0;
      const sc = e.identity.spacecraftName;
      if (sc) {
        const p = positionAt(e.table, sc, now);
        this.telemetry.socket.emit(
          JSON.stringify({ et: now, position: [p[0] + 2, p[1] - 1, p[2] + 0.5] }),
        );
        const latest = this.telemetry.adapter.latest();
        if (latest) this.store.setState({ telemetryResidualKm: latest.residualKm });
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // Distance between the first two selected objects, when both have ephemerides.
  // Updated on the readout throttle; only written when it changes meaningfully so
  // a paused scene does not re-render every tick.
  private updateMeasurement(et: number): void {
    const e = this.core;
    if (!e) return;
    const sel = this.store.getState().selection;
    const current = this.store.getState().measurement;
    if (sel.length < 2 || !e.table.byBody.has(sel[0]!) || !e.table.byBody.has(sel[1]!)) {
      if (current) this.store.setState({ measurement: null });
      return;
    }
    const from = sel[0]!;
    const to = sel[1]!;
    const a = positionAt(e.table, from, et);
    const b = positionAt(e.table, to, et);
    const distanceKm = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const relativeSpeedKmS = rangeRate(
      a,
      b,
      velocityAt(e.table, from, et),
      velocityAt(e.table, to, et),
    );
    const angleDeg = this.angleFromObserver(from, to, et);
    if (
      current &&
      current.from === from &&
      current.to === to &&
      Math.abs(current.distanceKm - distanceKm) < 1 &&
      anglesClose(current.angleDeg, angleDeg)
    ) {
      return;
    }
    this.store.setState({ measurement: { from, to, distanceKm, relativeSpeedKmS, angleDeg } });
  }

  // Angular separation of the two objects seen from the spacecraft observer.
  private angleFromObserver(from: string, to: string, et: number): number | null {
    const e = this.core;
    const observer = e?.identity.spacecraftName;
    if (!e || !observer || from === observer || to === observer || !e.table.byBody.has(observer))
      return null;
    const o = positionAt(e.table, observer, et);
    const a = positionAt(e.table, from, et);
    const b = positionAt(e.table, to, et);
    const va: [number, number, number] = [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
    const vb: [number, number, number] = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
    const la = Math.hypot(va[0], va[1], va[2]);
    const lb = Math.hypot(vb[0], vb[1], vb[2]);
    if (la === 0 || lb === 0) return null;
    const cos = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / (la * lb);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  }

  // Pointer-drag orbit, wheel zoom, and click-to-pick. Returns a cleanup function.
  attachPointer(): () => void {
    const canvas = this.canvas;
    let dragging = false;
    let px = 0;
    let py = 0;
    let moved = 0;
    const down = (ev: PointerEvent): void => {
      dragging = true;
      px = ev.clientX;
      py = ev.clientY;
      moved = 0;
    };
    const move = (ev: PointerEvent): void => {
      if (!dragging || !this.core) return;
      const dx = ev.clientX - px;
      const dy = ev.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);
      this.core.scene.orbitBy(dx * 0.005, dy * 0.005);
      px = ev.clientX;
      py = ev.clientY;
    };
    const up = (ev: PointerEvent): void => {
      // A press that did not drag is a click: pick the object under the cursor.
      if (dragging && moved < 5) this.pickAt(ev.clientX, ev.clientY);
      dragging = false;
    };
    const wheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      this.core?.scene.zoomBy(ev.deltaY > 0 ? 1.1 : 0.9);
    };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }

  // Pick the body or spacecraft under a screen position and center on it. Misses
  // (clicks on empty space) leave the selection unchanged.
  pickAt(clientX: number, clientY: number): void {
    const core = this.core;
    if (!core) return;
    const rect = this.canvas.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return;
    }
    const ndc = pointerToNdc(clientX, clientY, rect);
    const id = core.scene.pickObjectAt(ndc.x, ndc.y);
    if (id) this.centerOn(id);
  }

  centerOn(body: string): void {
    this.store.setState({ focus: body, selection: [body] });
    if (!this.core) return;
    this.core.scene.centerOn(body);
    this.core.scene.setView(0.6, 0.35, FOCUS_DISTANCE[body] ?? DEFAULT_FOCUS_DISTANCE);
  }

  // Set the camera to look along a world-space direction (Cosmographia's
  // "set the view from a vector"), keeping the current focus and distance.
  viewAlong(direction: Km3): void {
    const e = this.core;
    if (!e) return;
    const { azimuth, elevation } = azimuthElevationFromDirection(direction);
    e.scene.setView(azimuth, elevation, e.scene.getView().distance);
  }

  // Look from the Sun toward the focus: the look direction is from the focus to
  // the Sun (which sits at the heliocentric origin), i.e. minus the focus position.
  viewFromSun(): void {
    const e = this.core;
    if (!e) return;
    const focusPos = positionAt(e.table, e.scene.focusBody, e.clock.state.et);
    this.viewAlong([-focusPos[0], -focusPos[1], -focusPos[2]]);
  }

  // Look straight down onto the ecliptic plane (top-down), so orbits read face-on.
  // The look direction is the ecliptic south pole in J2000 equatorial coords
  // (obliquity 23.4366 deg), placing the camera over the ecliptic north pole.
  viewTopDown(): void {
    this.viewAlong([0, 0.397777, -0.917482]);
  }

  // Look down-track along the spacecraft velocity, if the mission has a spacecraft.
  viewAlongVelocity(): void {
    const e = this.core;
    const sc = e?.identity.spacecraftName;
    if (!e || !sc) return;
    this.viewAlong(velocityAt(e.table, sc, e.clock.state.et));
  }

  // Build a ViewModel for the current camera, epoch, and selection.
  private async buildViewModel(): Promise<ViewModel | null> {
    const e = this.core;
    if (!e) return null;
    const v = e.scene.getView();
    const utc = await e.spice.et2utc(e.clock.state.et, 'ISOC', 3);
    return {
      t: `${utc}Z`,
      camera: {
        mode: 'center',
        target: v.focus,
        distance: v.distance,
        azimuth: v.azimuth,
        elevation: v.elevation,
      },
      selection: this.store.getState().selection,
      visibility: {},
      plugins: [],
    };
  }

  async share(): Promise<void> {
    const view = await this.buildViewModel();
    if (!view) return;
    window.location.hash = encodeView(view);
    try {
      await navigator.clipboard?.writeText(window.location.href);
    } catch {
      // Clipboard may be unavailable; the URL hash is still updated.
    }
  }

  private async loadBookmarksFromStorage(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const bookmarks = await loadBookmarks(e.storage);
    if (!this.disposed) this.store.setState({ bookmarks });
  }

  async saveBookmark(name: string): Promise<void> {
    const e = this.core;
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    const view = await this.buildViewModel();
    if (!view) return;
    const bookmark: Bookmark = { id: newBookmarkId(), name: trimmed, hash: encodeView(view) };
    const next = [...this.store.getState().bookmarks, bookmark];
    this.store.setState({ bookmarks: next });
    await persistBookmarks(e.storage, next);
  }

  async applyBookmark(id: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    const bookmark = this.store.getState().bookmarks.find((b) => b.id === id);
    if (!bookmark) return;
    try {
      const view = decodeView(bookmark.hash);
      await applyViewModel(e.scene, e.clock, e.spice, this.store, view, this.isDisposed);
      window.location.hash = bookmark.hash;
    } catch (err) {
      console.error('failed to apply bookmark', err);
    }
  }

  async deleteBookmark(id: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    const next = this.store.getState().bookmarks.filter((b) => b.id !== id);
    this.store.setState({ bookmarks: next });
    await persistBookmarks(e.storage, next);
  }

  scrub(value: number): void {
    this.store.setState({ et: value });
    this.core?.clock.setEpoch(value);
  }

  toggleTrack(): void {
    const next = !this.store.getState().track;
    this.store.setState({ track: next });
    const sc = this.core?.identity.spacecraftName;
    if (next && sc) this.centerOn(sc);
  }

  toggleInstruments(): void {
    const next = !this.store.getState().instruments;
    this.store.setState({ instruments: next });
    if (this.core && !next) {
      // Clear the FOV cone and footprint when instruments are turned off.
      const anchor = this.core.instrument?.descriptor.anchorName ?? 'Sun';
      this.core.scene.setFovCone([0, 0, 0], []);
      this.core.scene.setFootprint([], anchor);
      this.store.setState({ footprintPoints: 0 });
    }
  }

  togglePlay(): void {
    this.store.setState((s) => ({ playing: !s.playing }));
  }

  setRate(rate: number): void {
    this.store.setState({ rate });
  }

  stepRate(dir: -1 | 1): void {
    const idx = RATE_STEPS.indexOf(this.store.getState().rate as (typeof RATE_STEPS)[number]);
    const base = idx < 0 ? 3 : idx;
    this.setRate(RATE_STEPS[Math.max(0, Math.min(RATE_STEPS.length - 1, base + dir))]!);
  }

  setSetting(key: SettingKey, value: boolean): void {
    this.store.setState((s) => ({ settings: { ...s.settings, [key]: value } }));
    const scene = this.core?.scene;
    if (!scene) return;
    if (key === 'trajectory') scene.setTrajectoryVisible(value);
    else if (key === 'orbits') scene.setOrbitsVisible(value);
    else if (key === 'labels') scene.setLabelsVisible(value);
    else if (key === 'fov') scene.setFovVisible(value);
    else if (key === 'footprint') scene.setFootprintVisible(value);
    else if (key === 'axes') scene.setAxesVisible(value);
    else if (key === 'stars') scene.setStarFieldVisible(value);
    else if (key === 'atmosphere') scene.setAtmosphereVisible(value);
    else if (key === 'shadows' && value) scene.enableShadows(scene.focusBodyRadiusKm());
  }

  toggleSelectObject(id: string): void {
    this.store.setState((s) => ({ selection: toggleSelection(s.selection, id) }));
  }

  toggleVisibleObject(id: string, visible: boolean): void {
    this.store.setState((s) => ({ visibility: { ...s.visibility, [id]: visible } }));
    this.core?.scene.setVisible(id, visible);
  }

  captureStill(): void {
    void captureStill(this.canvas)
      .then((blob) => downloadBlob(blob, 'bessel.png'))
      .catch((err: unknown) => console.error('capture failed', err));
  }

  toggleRecording(): void {
    if (this.recorder) {
      void this.recorder.stop().then((blob) => downloadBlob(blob, 'bessel.webm'));
      this.recorder = null;
      this.store.setState({ recording: false });
    } else {
      try {
        this.recorder = startRecording(this.canvas);
        this.store.setState({ recording: true });
      } catch (err) {
        console.error('recording failed', err);
      }
    }
  }

  // Parse and validate a picked or dropped catalog file. On success the object
  // list becomes catalog-driven; for a native catalog the 3D scene is rebuilt
  // from it (arbitrary-mission rendering). On failure a located error is shown
  // loudly (CLAUDE.md: never a silent fallback).
  async loadCatalog(file: { name: string; text: string }): Promise<void> {
    let loaded;
    try {
      loaded = parseAnyCatalog(file.name, file.text);
    } catch (err) {
      this.store.setState({ loadError: formatLoadError(err) });
      return;
    }
    this.store.setState({ objects: loaded.entries, loadedName: loaded.name, loadError: null });

    // Cosmographia single-spacecraft catalogs update only the object list for now;
    // a native catalog with a spacecraft time window re-renders the scene
    // generically. A bodies-only catalog (no window to sample over) updates only
    // the object list, never a loud error.
    const hasWindow = !!loaded.catalog?.spacecraft?.[0]?.arcs?.[0]?.timeRange;
    if (loaded.kind === 'native' && loaded.catalog && hasWindow) {
      await this.renderNativeMission(loaded.catalog);
    }
  }

  // Load a mission from the plugin registry: lazily activate the plugin (fetch
  // and parse its catalog, once) and render it, surfacing the registry in the UI.
  async loadMission(registry: PluginRegistry, id: string): Promise<void> {
    const plugin = registry.get(id);
    if (!plugin) return;
    try {
      this.store.setState({ status: `Loading ${plugin.name}` });
      const catalog = await registry.activate(id);
      this.store.setState({
        objects: nativeEntries(catalog),
        loadedName: catalog.name ?? plugin.name,
        loadError: null,
      });
      await this.renderNativeMission(catalog);
    } catch (err) {
      this.store.setState({ status: 'Ready', loadError: formatLoadError(err) });
    }
  }

  // Rebuild the rendered scene from a parsed native catalog. Shared by the file
  // loader and the plugin registry; the object list is set by the caller.
  private async renderNativeMission(catalog: BesselCatalog): Promise<void> {
    const e = this.core;
    if (!e) return;
    try {
      this.store.setState({ status: 'Building mission' });
      const mission = await buildCatalogMissionScene(e.spice, catalog, (status) =>
        this.store.setState({ status }),
      );
      if (this.disposed) return;
      e.scene.reset();
      buildScene(e.scene, mission.spec);
      if (mission.spacecraftModel) e.scene.setSpacecraftModel(mission.spacecraftModel);
      // Swap the live mission state the frame loop reads each tick.
      e.table = mission.table;
      e.identity = mission.identity;
      e.instrument = await loadInstrument(e.spice, mission.instrument ?? null);
      this.startTelemetry();
      const [et0, et1] = mission.window;
      e.clock.setEpoch(et0);
      this.store.setState({
        bounds: [et0, et1],
        et: et0,
        focus: mission.identity.centerBody,
        selection: [mission.identity.centerBody],
        footprintPoints: 0,
        fovOk: !!e.instrument,
        status: 'Ready',
      });
    } catch (err) {
      this.store.setState({ status: 'Ready', loadError: formatLoadError(err) });
    }
  }

  // Run a short scripted tour over the viewer (surfaces the scripting API).
  runTour(): void {
    const script = createScript(this, this.store);
    script.setTimeRate(3600).unpause().viewFromSun();
  }

  // Start a mock predicted-versus-actual telemetry feed for the active spacecraft
  // (surfaces the TelemetryAdapter). The frame loop emits synthetic frames.
  private startTelemetry(): void {
    this.stopTelemetry();
    const e = this.core;
    const sc = e?.identity.spacecraftName;
    if (!e || !sc) {
      this.store.setState({ telemetryResidualKm: null });
      return;
    }
    const socket = new MockTelemetrySocket();
    const adapter = new TelemetryAdapter(socket, (et) =>
      this.core ? positionAt(this.core.table, sc, et) : [0, 0, 0],
    );
    this.telemetry = { socket, adapter };
  }

  private stopTelemetry(): void {
    if (this.telemetry) {
      this.telemetry.adapter.dispose();
      this.telemetry = null;
    }
  }

  // Fetch a bundled sample catalog by URL and load it (e.g. the Cassini sample).
  async loadCatalogUrl(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Sample not found at ${url} (${res.status})`);
      const text = await res.text();
      const name = url.split('/').pop() ?? url;
      await this.loadCatalog({ name, text });
    } catch (err) {
      this.store.setState({ loadError: formatLoadError(err) });
    }
  }

  // Furnish an uploaded kernel's bytes to SPICE so an arbitrary mission whose
  // kernels are not bundled can be rendered, and persist it to OPFS (best effort)
  // so a reload finds it. Returns a loud error string on failure, else null.
  async uploadKernel(name: string, bytes: Uint8Array): Promise<string | null> {
    const e = this.core;
    if (!e) return 'Engine not ready';
    try {
      await e.spice.furnsh(name, bytes);
      await e.fs.writeFile(`/kernels/${name}`, bytes).catch((err: unknown) => {
        // Persistence is best-effort; the kernel is already usable this session.
        console.error('kernel persist failed', err);
      });
      return null;
    } catch (err) {
      const message = formatLoadError(err);
      this.store.setState({ loadError: message });
      return message;
    }
  }

  toggleHelp(): void {
    this.store.setState((s) => ({ helpOpen: !s.helpOpen }));
  }

  setHelpOpen(open: boolean): void {
    this.store.setState({ helpOpen: open });
  }

  keyboardAction(action: KeyboardAction): void {
    const e = this.core;
    if (!e) return;
    const s = this.store.getState();
    if (action.type === 'playToggle') this.togglePlay();
    else if (action.type === 'scrub') {
      const step = (s.bounds[1] - s.bounds[0]) / 200;
      const next = e.clock.state.et + action.direction * step;
      this.scrub(Math.max(s.bounds[0], Math.min(s.bounds[1], next)));
    } else if (action.type === 'rate') this.stepRate(action.direction);
    else if (action.type === 'center') {
      if (s.selection[0]) this.centerOn(s.selection[0]);
    } else if (action.type === 'help') this.toggleHelp();
  }
}
