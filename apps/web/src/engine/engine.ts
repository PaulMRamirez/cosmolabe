// BesselEngine owns the imperative side of the viewer: the camera-relative scene,
// the clock, the SPICE worker client, and the requestAnimationFrame loop. The
// loop reads live UI state straight from the store (playing, rate, track,
// instruments) instead of the mirror refs the monolithic viewer carried, and
// writes derived state (et, epochLabel, readouts, footprint count) back to it.
// React subscribes to the store; user actions call the methods below.

import { pointerToNdc, type Km3 } from '@bessel/scene';
import {
  captureStill,
  downloadBlob,
  startRecording,
  type KeyboardAction,
  type Recorder,
  type SettingKey,
} from '@bessel/ui';
import { encodeView, type ViewModel } from '@bessel/state';
import { positionAt, velocityAt } from '../sampler.ts';
import { fovRim, footprint } from '../instruments.ts';
import { toggleSelection } from '../selection.ts';
import { parseAnyCatalog, formatLoadError } from '../catalog-load.ts';
import type { AppStore } from '../store/index.ts';
import { bootScene, type EngineCore } from './bootstrap.ts';
import { pushEpochLabel, pushReadouts } from './telemetry.ts';
import { FOCUS_DISTANCE, DEFAULT_FOCUS_DISTANCE, RATE_STEPS } from './constants.ts';

export class BesselEngine {
  private core: EngineCore | null = null;
  private raf = 0;
  private lastTs = 0;
  private labelAccum = 0;
  private instrumentAccum = 0;
  private readoutAccum = 0;
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
      this.raf = requestAnimationFrame(this.frame);
      this.store.setState({ status: 'Ready', ready: true });
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

    // Track-along-trajectory camera: follow Cassini down its velocity.
    if (s.track) {
      e.scene.setFocusVelocity(velocityAt(e.table, 'Cassini', now));
      e.scene.setCameraMode('track');
    } else {
      e.scene.setCameraMode('orbit');
    }

    // Sensor FOV cone (cheap, every frame) and footprint (throttled, async).
    if (s.instruments && e.fov) {
      const scPos = positionAt(e.table, 'Cassini', now);
      const satPos = positionAt(e.table, 'Saturn', now);
      e.scene.setFovCone(scPos, fovRim(scPos, satPos, e.fov));
      this.instrumentAccum += dt;
      if (this.instrumentAccum > 0.4) {
        this.instrumentAccum = 0;
        const fovRef = e.fov;
        void footprint(e.spice, now, fovRef).then(
          (pts) => {
            if (!this.disposed && this.store.getState().instruments) {
              e.scene.setFootprint(pts, 'Saturn', '#ff33cc');
              this.store.setState({ footprintPoints: pts.length });
            }
          },
          (err: unknown) => console.error('footprint failed', err),
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
      pushReadouts(e.spice, this.store, e.scene.focusBody, now, this.isDisposed);
      this.updateMeasurement(now);
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
    if (
      current &&
      current.from === from &&
      current.to === to &&
      Math.abs(current.distanceKm - distanceKm) < 1
    ) {
      return;
    }
    this.store.setState({ measurement: { from, to, distanceKm } });
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

  async share(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const v = e.scene.getView();
    const utc = await e.spice.et2utc(e.clock.state.et, 'ISOC', 3);
    const view: ViewModel = {
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
    window.location.hash = encodeView(view);
    try {
      await navigator.clipboard?.writeText(window.location.href);
    } catch {
      // Clipboard may be unavailable; the URL hash is still updated.
    }
  }

  scrub(value: number): void {
    this.store.setState({ et: value });
    this.core?.clock.setEpoch(value);
  }

  toggleTrack(): void {
    const next = !this.store.getState().track;
    this.store.setState({ track: next });
    if (next) this.centerOn('Cassini');
  }

  toggleInstruments(): void {
    const next = !this.store.getState().instruments;
    this.store.setState({ instruments: next });
    if (this.core && !next) {
      // Clear the FOV cone and footprint when instruments are turned off.
      this.core.scene.setFovCone([0, 0, 0], []);
      this.core.scene.setFootprint([], 'Saturn');
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
    else if (key === 'labels') scene.setLabelsVisible(value);
    else if (key === 'fov') scene.setFovVisible(value);
    else if (key === 'footprint') scene.setFootprintVisible(value);
    else if (key === 'axes') scene.setAxesVisible(value);
    else if (key === 'stars') scene.setStarFieldVisible(value);
    else if (key === 'atmosphere') scene.setAtmosphereVisible(value);
    else if (key === 'shadows' && value) scene.enableShadows(60268);
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
  // list becomes catalog-driven; on failure a located error is shown loudly.
  loadCatalog(file: { name: string; text: string }): void {
    try {
      const loaded = parseAnyCatalog(file.name, file.text);
      this.store.setState({
        objects: loaded.entries,
        loadedName: loaded.name,
        loadError: null,
      });
    } catch (err) {
      this.store.setState({ loadError: formatLoadError(err) });
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
