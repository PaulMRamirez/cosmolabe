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
  isEditableTarget,
  startRecording,
  type KeyboardAction,
  type Recorder,
  type SettingKey,
} from '@bessel/ui';
import { encodeView, decodeView, TelemetryAdapter, type ViewModel } from '@bessel/state';
import { eclipseIntervals } from '@bessel/events';
import { describeProvider, type ProviderKind, type ProviderSpec } from '@bessel/spice';
import { computeAccess, computeElevationAccess, type Facility } from '@bessel/access';
import { figureOfMerit } from '@bessel/coverage';
import { windowIntersect } from '@bessel/timeline';
import { linkBudget } from '@bessel/rf';
import { closestApproachLinear, collisionProbability2D } from '@bessel/conjunction';
import { walkerConstellation } from '@bessel/coverage';
import { eigenAxisSlew, nadirAttitude, sunPointingAttitude, type Quaternion } from '@bessel/attitude';
import { lambert } from '@bessel/mission';
import { writeOem, type Oem } from '@bessel/interop';
import {
  parseTle,
  sgp4init,
  sgp4,
  publishEphemeris,
  emptyTable,
  propagateCowell,
} from '@bessel/propagator';
import { SAMPLE_TLE } from '../sample-tle.ts';

// Earth gravity constants for the numerical (HPOP) propagation. Published WGS-84/EGM
// values, caller-injected because a PCK carries no GM or harmonics.
const EARTH_GM = 398600.4418;
const EARTH_RE = 6378.137;
const EARTH_J2 = 1.08262668e-3;
import type { PluginRegistry, BesselCatalog } from '@bessel/catalog';
import { HttpKernelSource } from '@bessel/pal-web';
import { furnishMissionKernels } from './load-mission.ts';
import { positionAt, velocityAt, rangeRate } from '../sampler.ts';
import { fovRim, footprint } from '../instruments.ts';
import { toggleSelection } from '../selection.ts';
import {
  parseAnyCatalog,
  nativeEntries,
  formatLoadError,
  DEFAULT_OBJECT_ENTRIES,
} from '../catalog-load.ts';
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
import { buildHpopForceModel, HPOP_FORCE_MODEL_LABELS, type HpopForceModel } from './hpop-model.ts';
import { runMcsDesign, type McsDesign } from './mcs.ts';
import { runOdDemo } from './od.ts';

// True when two optional angles are equal or both absent (within tolerance).
function anglesClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}
import { pushEpochLabel, pushReadouts } from './telemetry.ts';
import { RATE_STEPS } from './constants.ts';

/** IAU body-fixed frame name for a body, for sync-orbit (e.g. Earth -> IAU_EARTH). */
function iauFrameFor(body: string): string {
  return `IAU_${body.toUpperCase()}`;
}

const preventDefault = (ev: Event): void => ev.preventDefault();

/** Optional time-span override (seconds) for a span-based analysis tool. */
export interface AnalysisSpan {
  readonly spanSec?: number;
  readonly stepSec?: number;
}

/** A span override plus an optional target object (for range/access). */
export interface AnalysisTargetSpan extends AnalysisSpan {
  readonly target?: string;
}

/** A data-provider workbench request: a provider over an observer/target pair + grid. */
export interface ReportConfig {
  readonly kind: ProviderKind;
  readonly observer: string;
  readonly target: string;
  readonly frame: string;
  readonly durationS: number;
  readonly stepS: number;
}

/** Build a concrete ProviderSpec from a report config (only frame-needing kinds use it). */
function providerFromConfig(cfg: ReportConfig): ProviderSpec {
  const { observer, target, frame } = cfg;
  switch (cfg.kind) {
    case 'range':
      return { kind: 'range', observer, target };
    case 'rangeRate':
      return { kind: 'rangeRate', observer, target };
    case 'speed':
      return { kind: 'speed', observer, target, frame };
    case 'position':
      return { kind: 'position', observer, target, frame };
    case 'velocity':
      return { kind: 'velocity', observer, target, frame };
    case 'subPointLonLat':
      return { kind: 'subPointLonLat', observer, target, frame };
  }
}

// Gravitational parameters (km^3/s^2) for the common central bodies, used by the
// maneuver-design solver only when the loaded kernels carry no GM in the pool. These
// are published physical constants (NAIF/DE440), not mission kernel data.
const CENTER_GM: Readonly<Record<string, number>> = {
  SUN: 1.32712440018e11,
  MERCURY: 2.2032e4,
  VENUS: 3.24859e5,
  EARTH: 3.986004418e5,
  MOON: 4.9028e3,
  MARS: 4.282837e4,
  JUPITER: 1.26686534e8,
  SATURN: 3.7931187e7,
  URANUS: 5.793939e6,
  NEPTUNE: 6.836529e6,
  PLUTO: 8.71e2,
};

export class BesselEngine {
  private core: EngineCore | null = null;
  private raf = 0;
  private lastTs = 0;
  private labelAccum = 0;
  private instrumentAccum = 0;
  private readoutAccum = 0;
  private attitudeAccum = 0;
  private telemetryAccum = 0;
  private syncAccum = 0;
  private syncFrameBody = '';
  private readonly heldKeys = new Set<string>();
  private telemetry: { socket: MockTelemetrySocket; adapter: TelemetryAdapter } | null = null;
  private recorder: Recorder | null = null;
  private disposed = false;
  private tleSeq = 0;
  // Logical kernel names already furnished this session, so a plugin load or a
  // re-upload never double-furnishes the same kernel (Cosmographia de-dups too).
  private readonly furnished = new Set<string>();
  // The most recently propagated satellite (NAIF id + epoch), for ground-station access.
  private lastTle: { bodyId: number; epoch: number } | null = null;

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

    // Camera mode: tracking the spacecraft overrides the user's base mode (orbit,
    // sync-orbit, or free) while it is on; otherwise the base mode applies.
    const scName = e.identity.spacecraftName;
    if (s.track && scName) {
      e.scene.setFocusVelocity(velocityAt(e.table, scName, now));
      e.scene.setCameraMode('track');
    } else {
      e.scene.setCameraMode(s.cameraMode);
      if (s.cameraMode === 'sync') this.updateSyncFrame(dt, now);
    }
    this.applyCameraKeys(dt);

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

    e.scene.render(dt);

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

  // Pointer (rotate / pan / pinch), wheel (zoom-to-cursor), and key input (free
  // fly, roll, FOV). Returns a cleanup function that detaches every listener.
  attachPointer(): () => void {
    const canvas = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: 'rotate' | 'pan' | null = null;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let pinch = 0;
    let pinchX = 0;
    let pinchY = 0;
    const centroid = (): { x: number; y: number; d: number } => {
      const pts = [...pointers.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const down = (ev: PointerEvent): void => {
      canvas.setPointerCapture?.(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        drag = ev.button === 2 || ev.shiftKey || ev.ctrlKey ? 'pan' : 'rotate';
        lastX = ev.clientX;
        lastY = ev.clientY;
        moved = 0;
      } else if (pointers.size === 2) {
        const c = centroid();
        pinch = c.d;
        pinchX = c.x;
        pinchY = c.y;
      }
    };
    const move = (ev: PointerEvent): void => {
      if (!this.core || !pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const rect = canvas.getBoundingClientRect();
      if (pointers.size >= 2) {
        // Pinch zoom plus two-finger truck from the centroid motion.
        const c = centroid();
        if (pinch > 0 && c.d > 0) this.core.scene.zoomBy(pinch / c.d);
        this.core.scene.panBy(-(c.x - pinchX) / rect.height, (c.y - pinchY) / rect.height);
        pinch = c.d;
        pinchX = c.x;
        pinchY = c.y;
        return;
      }
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (drag === 'pan') this.core.scene.panBy(-dx / rect.height, dy / rect.height);
      else this.core.scene.orbitBy(dx * 0.005, dy * 0.005);
    };
    const up = (ev: PointerEvent): void => {
      if (pointers.size === 1 && drag === 'rotate' && moved < 5) this.pickAt(ev.clientX, ev.clientY);
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = 0;
      // When a pinch drops to one finger, reseed from the surviving pointer so the
      // next single-finger delta does not jump from a stale (pre-pinch) origin.
      if (pointers.size === 1) {
        const r = [...pointers.values()][0]!;
        lastX = r.x;
        lastY = r.y;
        moved = 0;
      }
      if (pointers.size === 0) drag = null;
    };
    const wheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 1.1 : 0.9;
      if (this.core?.scene.cameraMode === 'free') {
        // In free-fly the wheel dollies the free camera forward/back.
        const step = Math.max(0.01, this.core.scene.freeRadius) * (ev.deltaY > 0 ? -0.1 : 0.1);
        this.core.scene.flyMove(step, 0, 0);
      } else {
        this.zoomToCursor(ev.clientX, ev.clientY, factor);
      }
    };
    const key = (isDown: boolean) => (ev: KeyboardEvent): void => {
      const k = ev.key.toLowerCase();
      if (k.length !== 1 || !'wasdqe,.-='.includes(k)) return;
      // Gate only key-DOWN on editable targets (so typing never starts motion);
      // key-UP must always release, or a key can stick when focus moves to an input.
      if (isDown) {
        if (isEditableTarget(ev.target)) return;
        this.heldKeys.add(k);
      } else {
        this.heldKeys.delete(k);
      }
    };
    const keyDown = key(true);
    const keyUp = key(false);
    const clearKeys = (): void => this.heldKeys.clear();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('contextmenu', preventDefault);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('contextmenu', preventDefault);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }

  /** Zoom by factor while nudging the look point toward the cursor (dolly-to-cursor). */
  private zoomToCursor(clientX: number, clientY: number, factor: number): void {
    const e = this.core;
    if (!e) return;
    e.scene.zoomBy(factor);
    // Pan is only expressed in orbit/sync, so only nudge the look point there.
    if (e.scene.cameraMode !== 'orbit' && e.scene.cameraMode !== 'sync') return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const halfTan = Math.tan((e.scene.cameraFovDeg * Math.PI) / 180 / 2);
    const aspect = rect.width / Math.max(1, rect.height);
    const fracX = nx * halfTan * aspect;
    const fracY = ny * halfTan;
    e.scene.panBy(fracX * (1 - factor), fracY * (1 - factor));
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

  centerOn(body: string, animate = true): void {
    // Framing implies an orbit view; leave free-fly so the framing takes effect.
    if (this.store.getState().cameraMode === 'free') this.setCameraMode('orbit');
    this.store.setState({ focus: body, selection: [body] });
    if (!this.core) return;
    // The scene frames the body by its radius and (when animate) glides to it.
    this.core.scene.centerOn(body, animate);
  }

  /**
   * Lighting analysis: compute the spacecraft's umbra (total-shadow) intervals over
   * one day from the current epoch, occulted by the mission center body, and store
   * them for the analysis panel. Requires a loaded spacecraft mission.
   */
  async computeEclipse(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ eclipseUmbra: [], eclipseSpan: null });
      return;
    }
    const t0 = e.clock.state.et;
    const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
    try {
      const ecl = await eclipseIntervals(e.spice, {
        observer: sc,
        body,
        bodyFrame: `IAU_${body.toUpperCase()}`,
        span,
        step: opts.stepSec ?? 120,
      });
      if (!this.disposed) this.store.setState({ eclipseUmbra: ecl.umbra, eclipseSpan: span });
    } catch (err) {
      if (!this.disposed) this.store.setState({ eclipseUmbra: [], eclipseSpan: span });
      console.error('eclipse analysis failed', err);
    }
  }

  /**
   * Range analysis: sample the spacecraft-to-center-body distance (km) over one day
   * from the current epoch and store it as a time series for the analysis chart.
   * Uses the batched spkpos path (one worker round-trip for all samples). Requires a
   * loaded spacecraft mission.
   */
  async computeRange(opts: AnalysisTargetSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ rangeSeries: null });
      return;
    }
    const target = opts.target ?? body;
    const t0 = e.clock.state.et;
    try {
      // F3: one cancellable evalSeries job computes the range column over the grid in
      // a single worker round-trip (the interpreter reduces position to range in the
      // worker), instead of shipping n*3 coordinates back to be reduced here.
      const series = await e.spice.evalSeries({
        grid: { start: t0, stop: t0 + (opts.spanSec ?? 86400), step: opts.stepSec ?? 360 },
        providers: [{ kind: 'range', observer: sc, target }],
      });
      if (!this.disposed) {
        this.store.setState({
          rangeSeries: { et: series.et, value: series.columns[0]!, label: `${sc} to ${target} (km)` },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ rangeSeries: null });
      console.error('range analysis failed', err);
    }
  }

  /**
   * Communications analysis: downlink Eb/N0 (dB) from the spacecraft to Earth over
   * one day, combining the geometric range (batched spkpos) with the @bessel/rf
   * link-budget physics for a representative DSN 34 m X-band station. Plotted as a
   * time series. Requires a spacecraft mission.
   */
  async computeLinkBudget(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    if (!sc) {
      this.store.setState({ linkSeries: null });
      return;
    }
    const t0 = e.clock.state.et;
    const spanSec = opts.spanSec ?? 86400;
    const samples = 240;
    const et = new Float64Array(samples);
    for (let i = 0; i < samples; i++) et[i] = t0 + (i / (samples - 1)) * spanSec;
    try {
      // Earth relative to the spacecraft at each epoch, reduced to a downlink range.
      const xyz = await e.spice.spkposBatch('EARTH', et, 'J2000', 'NONE', sc);
      const ebN0 = new Float64Array(samples);
      for (let i = 0; i < samples; i++) {
        const distanceKm = Math.hypot(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!);
        // Representative Cassini X-band downlink to a DSN 34 m station.
        ebN0[i] = linkBudget({
          eirpDbW: 90,
          distanceKm,
          freqHz: 8.4e9,
          gOverTDbK: 53,
          dataRateBps: 14_000,
        }).ebN0Db;
      }
      if (!this.disposed) {
        this.store.setState({ linkSeries: { et, value: ebN0, label: `${sc} to Earth Eb/N0 (dB)` } });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ linkSeries: null });
      console.error('link-budget analysis failed', err);
    }
  }

  /**
   * Access analysis: line-of-sight visibility windows from the spacecraft to the Sun
   * over one day, occulted by the mission center body (a true STK-style access run
   * through @bessel/access, the geometry-finder + window-algebra path). The result is
   * the sunlit window; its complement is the eclipse. Requires a spacecraft mission.
   */
  async computeAccess(opts: AnalysisTargetSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ accessWindow: null, accessSpan: null });
      return;
    }
    const target = opts.target ?? 'SUN';
    const t0 = e.clock.state.et;
    const span: [number, number] = [t0, t0 + (opts.spanSec ?? 86400)];
    try {
      const window = await computeAccess(e.spice, {
        observer: sc,
        target,
        span,
        step: opts.stepSec ?? 120,
        constraints: [
          { kind: 'lineOfSight', body, bodyFrame: `IAU_${body.toUpperCase()}` },
        ],
      });
      // Reduce the access window to a figure of merit (@bessel/coverage): the
      // fraction of the span with line of sight, the access count, and the worst gap.
      const fom = figureOfMerit(window, span);
      if (!this.disposed) {
        this.store.setState({
          accessWindow: window,
          accessSpan: span,
          accessLabel: `${sc} to ${target}`,
          accessFom: {
            percentCoverage: fom.percentCoverage,
            accessCount: fom.accessCount,
            maxGapSec: fom.maxGapSec,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ accessWindow: null, accessSpan: span, accessFom: null });
      console.error('access analysis failed', err);
    }
  }

  /**
   * Conjunction analysis: rectilinear closest approach of the center body relative to
   * the spacecraft from the current epoch, plus a 2D probability of collision under an
   * assumed encounter covariance (@bessel/conjunction). A demonstration of the close-
   * approach + Pc math on the loaded pair. Requires a spacecraft mission.
   */
  async computeConjunction(opts: { secondary?: string } = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ conjunction: null });
      return;
    }
    const secondary = opts.secondary ?? body;
    const et = e.clock.state.et;
    try {
      const rel = await e.spice.spkezr(secondary, et, 'J2000', 'NONE', sc);
      const ca = closestApproachLinear(rel.position, rel.velocity);
      // An illustrative encounter: 1 km position sigma per axis, a 100 m combined
      // hard-body radius, the miss projected onto two encounter-plane axes.
      const pc = collisionProbability2D({
        radiusKm: 0.1,
        sigmaXKm: 1,
        sigmaYKm: 1,
        missXKm: ca.missKm,
        missYKm: 0,
      });
      if (!this.disposed) {
        this.store.setState({
          conjunction: {
            tcaSec: ca.tca,
            missKm: ca.missKm,
            relSpeedKmS: ca.relSpeedKmS,
            pc,
            label: `${sc} vs ${secondary}`,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ conjunction: null });
      console.error('conjunction analysis failed', err);
    }
  }

  /**
   * Constellation design: generate a Walker Delta 24/3/1 LEO pattern (@bessel/
   * coverage) and report its structure. Pure (element-set generation); independent of
   * the loaded mission, surfacing the constellation designer.
   */
  computeConstellation(): void {
    const totalSats = 24;
    const planes = 3;
    const phasing = 1;
    const inclinationDeg = 53;
    const altitudeKm = 700;
    const a = 6378.137 + altitudeKm;
    const sats = walkerConstellation({
      a,
      e: 0,
      i: (inclinationDeg * Math.PI) / 180,
      argp: 0,
      totalSats,
      planes,
      phasing,
      pattern: 'delta',
    });
    this.store.setState({
      constellation: {
        totalSats: sats.length,
        planes,
        perPlane: sats.length / planes,
        pattern: 'delta',
        inclinationDeg,
        altitudeKm,
      },
    });
  }

  /**
   * Attitude analysis: an eigen-axis slew from a nadir-pointing to a sun-pointing
   * attitude at the current epoch, honoring a max rate and acceleration, sampled as a
   * slew-angle (deg) time series (@bessel/attitude). Requires a spacecraft mission.
   */
  async computeSlew(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ slewSeries: null });
      return;
    }
    const et = e.clock.state.et;
    try {
      const [nadirM, sunM] = await Promise.all([
        nadirAttitude(e.spice, sc, body, et),
        sunPointingAttitude(e.spice, sc, body, et),
      ]);
      const a0 = await e.spice.m2q(nadirM);
      const a1 = await e.spice.m2q(sunM);
      const q0: Quaternion = [a0[0]!, a0[1]!, a0[2]!, a0[3]!];
      const q1: Quaternion = [a1[0]!, a1[1]!, a1[2]!, a1[3]!];
      // 2 deg/s max rate, 0.5 deg/s^2 max acceleration.
      const slew = eigenAxisSlew(q0, q1, (2 * Math.PI) / 180, (0.5 * Math.PI) / 180);
      const samples = 120;
      const t = new Float64Array(samples);
      const angleDeg = new Float64Array(samples);
      const rad2deg = 180 / Math.PI;
      for (let i = 0; i < samples; i++) {
        const ti = (i / (samples - 1)) * slew.duration;
        const q = slew.at(ti);
        const dotAbs = Math.abs(q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]);
        t[i] = ti;
        angleDeg[i] = 2 * Math.acos(Math.min(1, dotAbs)) * rad2deg;
      }
      if (!this.disposed) {
        this.store.setState({
          slewSeries: { et: t, value: angleDeg, label: `${sc} nadir->Sun slew (deg)` },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ slewSeries: null });
      console.error('slew analysis failed', err);
    }
  }

  /**
   * Maneuver design: solve a Lambert transfer (@bessel/mission) from the spacecraft's
   * current position about the center body to a target point a quarter-revolution
   * ahead in the orbit plane, over a quarter of the circular period at that radius,
   * and report the departure delta-v relative to the current velocity. The 90 deg
   * geometry keeps the boundary-value problem well posed for any arc (including a
   * hyperbolic flyby). Requires a spacecraft mission and the center body's GM.
   */
  async computeTransfer(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ transfer: null });
      return;
    }
    const mu = await this.centerMu(body);
    if (mu === null) {
      this.store.setState({ transfer: null });
      return;
    }
    const et = e.clock.state.et;
    try {
      const s1 = await e.spice.spkezr(sc, et, 'J2000', 'NONE', body);
      const r = s1.position;
      const v = s1.velocity;
      const rMag = Math.hypot(r.x, r.y, r.z);
      // Orbit normal (unit), then the target a quarter turn ahead at the same radius.
      const nx = r.y * v.z - r.z * v.y;
      const ny = r.z * v.x - r.x * v.z;
      const nz = r.x * v.y - r.y * v.x;
      const nMag = Math.hypot(nx, ny, nz) || 1;
      const un = { x: nx / nMag, y: ny / nMag, z: nz / nMag };
      // r2 = n x r (a 90 deg in-plane rotation of r about the orbit normal).
      const r2 = {
        x: un.y * r.z - un.z * r.y,
        y: un.z * r.x - un.x * r.z,
        z: un.x * r.y - un.y * r.x,
      };
      const tofSec = (Math.PI / 2) * Math.sqrt(rMag ** 3 / mu); // quarter circular period
      const sol = lambert(r, r2, tofSec, mu);
      const dv = Math.hypot(sol.v1.x - v.x, sol.v1.y - v.y, sol.v1.z - v.z);
      if (!this.disposed) {
        this.store.setState({
          transfer: { deltaVKmS: dv, tofHours: tofSec / 3600, label: `${sc} Lambert arc` },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ transfer: null });
      console.error('transfer analysis failed', err);
    }
  }

  /**
   * Ground-track analysis: the sub-spacecraft longitude/latitude over one day in the
   * center body's body-fixed frame, for the 2D map overlay (@bessel/ui GroundTrackMap;
   * the projection is equirectangular). Requires a spacecraft mission.
   */
  async computeGroundTrack(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) {
      this.store.setState({ groundTrack: null });
      return;
    }
    const t0 = e.clock.state.et;
    try {
      // F3: one evalSeries job returns the sub-spacecraft longitude/latitude (radians)
      // in the body-fixed frame; @bessel/ui GroundTrackMap projects it via
      // @bessel/map-projection. No ad hoc lon/lat math in the app.
      const series = await e.spice.evalSeries({
        grid: { start: t0, stop: t0 + (opts.spanSec ?? 86400), step: opts.stepSec ?? 240 },
        providers: [
          { kind: 'subPointLonLat', observer: body, target: sc, frame: `IAU_${body.toUpperCase()}` },
        ],
      });
      if (!this.disposed) {
        this.store.setState({
          groundTrack: { lon: series.columns[0]!, lat: series.columns[1]!, label: `${sc} ground track` },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ groundTrack: null });
      console.error('ground-track analysis failed', err);
    }
  }

  /**
   * Interoperability: export the spacecraft's trajectory over the loaded window as a
   * CCSDS OEM (KVN) document (@bessel/interop writeOem) and download it. Requires a
   * spacecraft mission.
   */
  async exportOem(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const sc = e.identity.spacecraftName;
    const body = e.identity.centerBody;
    if (!sc || !body) return;
    const [t0, t1] = this.store.getState().bounds;
    const samples = 25;
    try {
      const states = await Promise.all(
        Array.from({ length: samples }, async (_unused, i) => {
          const et = t0 + (i / (samples - 1)) * (t1 - t0);
          const s = await e.spice.spkezr(sc, et, 'J2000', 'NONE', body);
          const epoch = await e.spice.et2utc(et, 'ISOC', 3);
          return {
            epoch: `${epoch}Z`,
            position: [s.position.x, s.position.y, s.position.z] as [number, number, number],
            velocity: [s.velocity.x, s.velocity.y, s.velocity.z] as [number, number, number],
          };
        }),
      );
      const oem: Oem = {
        version: '2.0',
        metadata: {
          objectName: sc,
          centerName: body.toUpperCase(),
          refFrame: 'ICRF',
          timeSystem: 'UTC',
          startTime: states[0]!.epoch,
          stopTime: states[states.length - 1]!.epoch,
        },
        states,
      };
      const blob = new Blob([writeOem(oem)], { type: 'text/plain' });
      downloadBlob(blob, `${sc.toLowerCase()}.oem`);
    } catch (err) {
      console.error('OEM export failed', err);
    }
  }

  /** Gravitational parameter (km^3/s^2) of a central body: from the kernel pool, or a
   * built-in constant for the common bodies when the loaded kernels carry no GM. */
  private async centerMu(body: string): Promise<number | null> {
    const e = this.core;
    if (!e) return null;
    try {
      const gm = await e.spice.bodvrd(body, 'GM');
      if (gm.length && Number.isFinite(gm[0])) return gm[0]!;
    } catch {
      // No GM in the pool; fall through to the constants table.
    }
    return CENTER_GM[body.toUpperCase()] ?? null;
  }

  /**
   * Propagation: parse the bundled sample TLE, run SGP4 over one day from its epoch,
   * publish the arc as an in-memory SPK Type-13 segment about the Earth, then query
   * that SPK through the F3 evalSeries pipeline for an altitude time series and a
   * ground track. This exercises the full @bessel/propagator path (TLE -> SGP4 ->
   * SPK-13 -> render) with no special-case geometry: the propagated orbit is read
   * back through the same spkpos pipeline as any other body. (Frame note: SGP4 is in
   * TEME; the segment is published as J2000, an arcminute-scale approximation near the
   * epoch. The EOP-aware TEME->J2000 conversion is the interop/frame work, #22.)
   */
  async propagateTle(): Promise<void> {
    const e = this.core;
    if (!e) return;
    try {
      const tle = parseTle(SAMPLE_TLE.line1, SAMPLE_TLE.line2);
      const rec = sgp4init(tle);
      // SPICE str2et rejects a trailing 'Z'; the TLE epoch is UTC regardless.
      const epoch = await e.spice.str2et(tle.epochUtc.replace(/Z$/, ''));
      const step = 60;
      const n = Math.floor(86400 / step) + 1;
      const et = new Float64Array(n);
      for (let i = 0; i < n; i++) et[i] = epoch + i * step;
      const table = emptyTable('J2000', et);
      for (let i = 0; i < n; i++) {
        const s = sgp4(rec, (et[i]! - epoch) / 60); // SGP4 tsince is in minutes
        (table.x as Float64Array)[i] = s.position[0];
        (table.y as Float64Array)[i] = s.position[1];
        (table.z as Float64Array)[i] = s.position[2];
        (table.vx as Float64Array)[i] = s.velocity[0];
        (table.vy as Float64Array)[i] = s.velocity[1];
        (table.vz as Float64Array)[i] = s.velocity[2];
      }
      const bodyId = -(990000 + this.tleSeq++);
      await publishEphemeris(e.spice, table, {
        name: `tle${-bodyId}.bsp`,
        body: bodyId,
        center: 399,
        degree: 7,
      });
      this.lastTle = { bodyId, epoch };
      const radii = await e.spice.bodvrd('EARTH', 'RADII').catch(() => [6378.137]);
      const re = radii[0] ?? 6378.137;
      const series = await e.spice.evalSeries({
        grid: { et },
        providers: [
          { kind: 'range', observer: '399', target: String(bodyId) },
          { kind: 'subPointLonLat', observer: '399', target: String(bodyId), frame: 'IAU_EARTH' },
        ],
      });
      const altitude = new Float64Array(n);
      for (let i = 0; i < n; i++) altitude[i] = series.columns[0]![i]! - re;
      if (!this.disposed) {
        this.store.setState({
          tleOrbit: {
            altitude: { et, value: altitude, label: `${SAMPLE_TLE.name} altitude (km)` },
            track: { lon: series.columns[1]!, lat: series.columns[2]!, label: `${SAMPLE_TLE.name} ground track` },
            periodMin: 1440 / tle.meanMotion,
            label: SAMPLE_TLE.name,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ tleOrbit: null });
      console.error('TLE propagation failed', err);
    }
  }

  /**
   * Ground-station access: passes of the last-propagated satellite over a
   * Goldstone-class station for one day, as the composition of two constraints from
   * the access library, above a 10 deg elevation mask (computeElevationAccess) AND
   * within a geocentric range gate (gfdist), intersected with the window algebra.
   * Both constraints resolve against the published satellite SPK alone, so this needs
   * no planetary ephemeris. Requires a prior TLE propagation. (STK §4.3.)
   */
  async computeStationAccess(): Promise<void> {
    const e = this.core;
    const last = this.lastTle;
    if (!e || !last) {
      this.store.setState({ stationAccess: null });
      return;
    }
    const target = String(last.bodyId);
    const deg = Math.PI / 180;
    const facility: Facility = {
      body: 'EARTH',
      bodyFrame: 'IAU_EARTH',
      lonRad: -116.89 * deg,
      latRad: 35.426 * deg,
      altKm: 1.0,
    };
    // A 12 hour span at a 2 minute step keeps the per-epoch elevation sweep responsive
    // (passes are far longer than the step); the range gate uses the same cadence.
    const span: [number, number] = [last.epoch, last.epoch + 43200];
    const maxRangeKm = 9000;
    try {
      // Elevation-mask access intersected with a geocentric range gate: two composed
      // constraints (the elevation finder and the gfdist distance finder).
      const elevation = await computeElevationAccess(e.spice, facility, target, span, 120, 10 * deg);
      const inRange = await e.spice.gfdist(target, 'NONE', '399', '<', maxRangeKm, 120, span[0], span[1]);
      const visible = windowIntersect(elevation, inRange);
      const fom = figureOfMerit(visible, span);
      if (!this.disposed) {
        this.store.setState({
          stationAccess: {
            window: visible,
            span,
            fom: {
              percentCoverage: fom.percentCoverage,
              accessCount: fom.accessCount,
              maxGapSec: fom.maxGapSec,
            },
            label: `Goldstone passes (>10 deg, <${maxRangeKm} km)`,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ stationAccess: null });
      console.error('station access failed', err);
    }
  }

  /**
   * Numerical (HPOP) propagation: take the TLE's initial osculating state, integrate
   * it over one day with the native Cowell propagator under a point-mass + J2 force
   * model (@bessel/propagator), publish the arc as an SPK, and plot its altitude. This
   * is the analytic-vs-numerical companion to the SGP4 run and exercises the new
   * integrator end-to-end. (Frame note: the TLE state is TEME, integrated as J2000, an
   * arcminute-scale approximation near the epoch; the J2 axis assumption holds.)
   */
  async propagateHpop(model: HpopForceModel = 'j2'): Promise<void> {
    const e = this.core;
    if (!e) return;
    try {
      const tle = parseTle(SAMPLE_TLE.line1, SAMPLE_TLE.line2);
      const rec = sgp4init(tle);
      const epoch = await e.spice.str2et(tle.epochUtc.replace(/Z$/, ''));
      const s0 = sgp4(rec, 0); // TEME state at the TLE epoch
      const step = 60;
      const n = Math.floor(86400 / step) + 1;
      const et = new Float64Array(n);
      for (let i = 0; i < n; i++) et[i] = epoch + i * step;
      const forceModel = buildHpopForceModel(model, { gm: EARTH_GM, re: EARTH_RE, j2: EARTH_J2 });
      const table = propagateCowell({
        state: {
          position: { x: s0.position[0], y: s0.position[1], z: s0.position[2] },
          velocity: { x: s0.velocity[0], y: s0.velocity[1], z: s0.velocity[2] },
        },
        epoch,
        etGrid: et,
        forceModel,
      });
      const bodyId = -(995000 + this.tleSeq++);
      await publishEphemeris(e.spice, table, { name: `hpop${-bodyId}.bsp`, body: bodyId, center: 399, degree: 7 });
      const series = await e.spice.evalSeries({
        grid: { et },
        providers: [{ kind: 'range', observer: '399', target: String(bodyId) }],
      });
      const altitude = new Float64Array(n);
      for (let i = 0; i < n; i++) altitude[i] = series.columns[0]![i]! - EARTH_RE;
      if (!this.disposed) {
        this.store.setState({
          hpopAltitude: {
            et,
            value: altitude,
            label: `${SAMPLE_TLE.name} HPOP altitude (km, ${HPOP_FORCE_MODEL_LABELS[model]})`,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ hpopAltitude: null });
      console.error('HPOP propagation failed', err);
    }
  }

  /**
   * Mission-design workbench: assemble a small Mission Control Sequence (initial state,
   * a coast, an impulsive maneuver, then a Target whose differential corrector tunes the
   * burn to reach a desired radius) and run it SPICE-free via @bessel/propagator. The
   * resulting Earth-centered arc is drawn as an orbit polyline (camera-relative, km
   * scaled in the scene), and the final state plus the differential-corrector report are
   * written to the store. (STK_PARITY_SPEC §4.3.)
   */
  async runMcsDesign(design: McsDesign): Promise<void> {
    const e = this.core;
    if (!e) return;
    try {
      const { result, arc } = await runMcsDesign(design);
      if (this.disposed) return;
      // Render the propagated arc as an Earth-anchored orbit polyline. The points are km
      // (Earth-centered J2000); the scene applies the camera-relative scale, so no raw
      // solar-system coordinates reach the GPU float32 buffers.
      if (arc.length >= 2) {
        e.scene.setOrbits([{ id: 'mcs-arc', anchorBody: 'Earth', points: arc, color: 0xffaa33 }]);
      }
      this.store.setState({ mcsResult: result });
    } catch (err) {
      if (!this.disposed) this.store.setState({ mcsResult: null });
      console.error('MCS design run failed', err);
    }
  }

  /**
   * Orbit-determination workbench: synthesize a small range / range-rate / angles
   * measurement set from a known truth orbit, perturb the initial guess, and recover the
   * state with @bessel/od batch least squares. SPICE-free and synchronous; writes the
   * estimate, residual RMS, and covariance summary to the store. (Tapley-Schutz-Born
   * §4.3; Vallado §10.2.)
   */
  runOd(noiseScale: number): void {
    try {
      const result = runOdDemo(noiseScale);
      if (!this.disposed) this.store.setState({ odResult: result });
    } catch (err) {
      if (!this.disposed) this.store.setState({ odResult: null });
      console.error('Orbit determination failed', err);
    }
  }

  /**
   * Data-provider workbench: evaluate any registered provider (range, position, sub-
   * point, ...) for an observer/target pair over a time grid in one F3 evalSeries job,
   * and build a unit-tagged report table (downsampled for display, full series kept
   * for CSV). This is the configurable generalization of the fixed analysis buttons.
   * (STK_PARITY_SPEC §4.10.)
   */
  async runReport(cfg: ReportConfig): Promise<void> {
    const e = this.core;
    if (!e) return;
    const desc = describeProvider(cfg.kind);
    const t0 = e.clock.state.et;
    const provider = providerFromConfig(cfg);
    try {
      const series = await e.spice.evalSeries({
        grid: { start: t0, stop: t0 + cfg.durationS, step: cfg.stepS },
        providers: [provider],
      });
      const n = series.et.length;
      const headers = ['UTC', ...series.names.map((nm) => `${nm} (${desc.unit})`)];
      // Downsample to at most ~25 display rows and label them with UTC.
      const maxDisplay = 25;
      const stride = Math.max(1, Math.ceil(n / maxDisplay));
      const idx: number[] = [];
      for (let i = 0; i < n; i += stride) idx.push(i);
      const utc = await Promise.all(idx.map((i) => e.spice.et2utc(series.et[i]!, 'ISOC', 1)));
      const rows = idx.map((i, j) => [utc[j]!, ...series.columns.map((c) => c[i]!)]);
      if (!this.disposed) {
        this.store.setState({
          report: {
            headers,
            rows,
            series: { et: series.et, columns: series.columns, names: series.names },
            label: `${desc.label}: ${cfg.observer} to ${cfg.target}`,
          },
        });
      }
    } catch (err) {
      if (!this.disposed) this.store.setState({ report: null });
      console.error('report failed', err);
    }
  }

  /** Set the base camera mode (orbit / sync-orbit / free); track overrides it live. */
  setCameraMode(mode: 'orbit' | 'sync' | 'free'): void {
    this.store.setState({ cameraMode: mode });
    // Apply to the scene now (not just next frame) so any mode conversion happens
    // before a follow-up setView (e.g. a preset) and is not clobbered.
    if (!this.store.getState().track) this.core?.scene.setCameraMode(mode);
    if (mode !== 'sync') this.core?.scene.setSyncFrame(null);
  }

  /**
   * Apply continuous camera input from currently-held keys each frame: roll
   * (, / .), FOV / telephoto (- / =) in any mode, and free-fly translation
   * (WASD + Q/E) when free mode is active.
   */
  private applyCameraKeys(dt: number): void {
    const e = this.core;
    if (!e || this.heldKeys.size === 0) return;
    const k = this.heldKeys;
    const mode = e.scene.cameraMode;
    // Roll is only expressed in orbit/sync, so only feed it there (avoids silently
    // accumulating roll in track/free that would snap in on return to orbit).
    if (mode === 'orbit' || mode === 'sync') {
      const roll = (k.has(',') ? 1 : 0) - (k.has('.') ? 1 : 0);
      if (roll) e.scene.rollBy(roll * dt * 1.2);
    }
    const fov = (k.has('-') ? 1 : 0) - (k.has('=') ? 1 : 0);
    if (fov) e.scene.fovBy(1 + fov * dt * 0.9);
    if (mode === 'free') {
      // Speed scales with how far the free camera is from the view center.
      const speed = Math.max(0.01, e.scene.freeRadius) * dt * 1.2;
      const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
      const right = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      const up = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
      if (fwd || right || up) e.scene.flyMove(fwd * speed, right * speed, up * speed);
    }
  }

  /** Refresh the body-fixed rotation feeding sync-orbit mode (throttled worker call). */
  private updateSyncFrame(dt: number, et: number): void {
    const e = this.core;
    if (!e) return;
    this.syncAccum += dt;
    const body = e.scene.focusBody;
    if (body !== this.syncFrameBody) {
      this.syncFrameBody = body;
      e.scene.setSyncFrame(null);
    }
    if (this.syncAccum < 0.1) return;
    this.syncAccum = 0;
    void e.spice.pxform(iauFrameFor(body), 'J2000', et).then(
      (rot) => {
        if (!this.disposed && this.store.getState().cameraMode === 'sync') e.scene.setSyncFrame(rot);
      },
      () => {
        // No body-fixed frame for this body at this epoch: fall back to plain orbit.
        if (!this.disposed) e.scene.setSyncFrame(null);
      },
    );
  }

  // Set the camera to look along a world-space direction (Cosmographia's
  // "set the view from a vector"), keeping the current focus and distance.
  viewAlong(direction: Km3): void {
    const e = this.core;
    if (!e) return;
    // A view preset is an orbit framing; leave free-fly so it takes effect.
    if (this.store.getState().cameraMode === 'free') this.setCameraMode('orbit');
    const { azimuth, elevation } = azimuthElevationFromDirection(direction);
    e.scene.setView(azimuth, elevation, e.scene.getView().distance, true);
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

  // Load a mission from the plugin registry, mirroring a Cosmographia add-on:
  // furnish the plugin's declared kernels in SPICE-data-before-objects order
  // BEFORE rendering, verify any declared frames resolve, then activate (fetch
  // and parse the catalog, once) and render. Fails loudly on a missing plugin,
  // an unresolved kernel, or an unresolved frame (never a silent fallback).
  async loadMission(registry: PluginRegistry, id: string): Promise<void> {
    const e = this.core;
    const plugin = registry.get(id);
    if (!plugin) {
      this.store.setState({
        status: 'Ready',
        loadError: `Unknown plugin "${id}" (not registered)`,
      });
      return;
    }
    if (!e) {
      this.store.setState({ loadError: 'Engine not ready' });
      return;
    }
    try {
      this.store.setState({ status: `Loading ${plugin.name}`, loadError: null });
      // SPICE data before objects: furnish each declared kernel in order, then
      // verify the declared frames resolve, all before the catalog renders.
      const source = new HttpKernelSource(
        Object.fromEntries(plugin.kernels.map((k) => [k.name, k.source])),
      );
      await furnishMissionKernels(plugin.kernels, plugin.frames ?? [], {
        resolve: async (ref) => source.read(await source.resolve(ref.name)),
        furnish: (name, bytes) => this.furnishKernel(name, bytes),
        isFurnished: (name) => this.furnished.has(name),
        verifyFrame: (frame) => this.verifyFrame(frame),
      });
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

  // Verify one declared SPICE frame resolves now that the kernels are furnished.
  // pxform throws a loud SpiceError for an unknown frame, so a typo in a plugin's
  // frame name surfaces as a located error instead of a silent identity rotation.
  private async verifyFrame(frame: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    try {
      await e.spice.pxform(frame, 'J2000', e.clock.state.et);
    } catch (err) {
      throw new Error(`Frame "${frame}" is not resolvable after furnishing kernels`, {
        cause: err,
      });
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

  // Unload the active mission and return to the neutral inner-solar-system scene,
  // mirroring Cosmographia's File > Unload Last Catalog. Furnished kernels stay
  // loaded (SPICE has no per-kernel unfurnsh here); only the rendered objects and
  // scene reset. Activation caches in the registry remain, so a re-load is cheap.
  unloadMission(): void {
    const e = this.core;
    this.stopTelemetry();
    if (e) {
      e.scene.reset();
      e.identity = { ...e.identity, spacecraftName: null };
    }
    this.store.setState({
      objects: [...DEFAULT_OBJECT_ENTRIES],
      loadedName: null,
      loadError: null,
      telemetryResidualKm: null,
      status: 'Ready',
    });
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
    if (!this.core) return 'Engine not ready';
    try {
      await this.furnishKernel(name, bytes);
      return null;
    } catch (err) {
      const message = formatLoadError(err);
      this.store.setState({ loadError: message });
      return message;
    }
  }

  // Furnish one kernel's bytes into SPICE (de-duplicated by logical name) and
  // persist them to OPFS best-effort so a reload finds them. Shared by the plugin
  // loader and the manual kernel upload so both honor the same de-dup and persist.
  private async furnishKernel(name: string, bytes: Uint8Array): Promise<void> {
    const e = this.core;
    if (!e) throw new Error('Engine not ready');
    if (this.furnished.has(name)) return;
    await e.spice.furnsh(name, bytes);
    this.furnished.add(name);
    await e.fs.writeFile(`/kernels/${name}`, bytes).catch((err: unknown) => {
      // Persistence is best-effort; the kernel is already usable this session.
      console.error('kernel persist failed', err);
    });
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
