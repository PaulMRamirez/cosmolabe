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
  rowMajor3x3ToQuaternion,
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
import { buildMissionAnnotations } from './mission-annotations.ts';
import { createScript } from '../scripting.ts';
import { runScript, type ScriptResult } from '../script-runner.ts';
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
import { type HpopForceModel } from './hpop-model.ts';
import { type McsDesign } from './mcs.ts';
import type {
  AnalysisSpan,
  AnalysisTargetSpan,
  ReportConfig,
  TleState,
} from './analysis-ops.ts';

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

// The analysis-engine request shapes (AnalysisSpan, AnalysisTargetSpan, ReportConfig)
// live in ./analysis-ops.ts alongside the operations that consume them, so importing
// the analysis packages stays behind the dynamic-import split boundary. The provider
// kind is needed eagerly only as a type on the ReportConfig surface.
export type { AnalysisSpan, AnalysisTargetSpan, ReportConfig } from './analysis-ops.ts';

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
  private frameAccum = 0;
  // The SPICE frame name last fed to 'frame' camera mode, so changing the frame
  // clears the stale rotation rather than co-rotating with the old basis.
  private cameraFrameName = '';
  private readonly heldKeys = new Set<string>();
  private telemetry: { socket: MockTelemetrySocket; adapter: TelemetryAdapter } | null = null;
  private recorder: Recorder | null = null;
  private disposed = false;
  // Logical kernel names already furnished this session, so a plugin load or a
  // re-upload never double-furnishes the same kernel (Cosmographia de-dups too).
  private readonly furnished = new Set<string>();
  // The propagator sequence counter and the most recently propagated satellite, shared
  // by the (lazily imported) TLE/HPOP/station-access ops. A mutable ref so those ops can
  // update it across separate dynamic-import calls without depending on this class.
  private readonly tleState: TleState = { seq: 0, last: null };

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
      else if (s.cameraMode === 'frame') this.updateCameraFrame(dt, now, s.cameraFrame);
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
      this.publishSpacecraftQuat(att.quaternion);
    } else if (att?.kind === 'uniform') {
      const q = uniformRotationQuaternion(att.axis, att.ratePerSec, now, att.epochEt);
      e.scene.setSpacecraftAttitudeQuaternion(q);
      this.publishSpacecraftQuat(q);
    } else if (att?.kind === 'spice') {
      this.attitudeAccum += dt;
      if (this.attitudeAccum > 0.2) {
        this.attitudeAccum = 0;
        const frame = att.frame;
        void e.spice.pxform(frame, 'J2000', now).then(
          (rot) => {
            if (this.disposed) return;
            e.scene.setSpacecraftAttitude(rot);
            this.publishSpacecraftQuat(rowMajor3x3ToQuaternion(rot));
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
        // Publish the full predicted-versus-actual series (the OpenMCT/Yamcs
        // overlay model) plus the latest scalar and any loud transport fault.
        this.store.setState({
          telemetryResidualKm: latest ? latest.residualKm : null,
          telemetryOverlay: this.telemetry.adapter.overlay(),
          telemetryFault: this.telemetry.adapter.error(),
        });
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // Mirror the applied spacecraft attitude quaternion to the store so the viewport
  // can expose it (data-sc-quat) for verification. Only written when it changes
  // beyond a small tolerance so a static (fixed) attitude does not re-render every
  // frame, while a spinning (uniform) attitude still updates.
  private publishSpacecraftQuat(q: readonly [number, number, number, number]): void {
    const prev = this.store.getState().spacecraftQuat;
    if (
      prev &&
      Math.abs(prev[0] - q[0]) < 1e-4 &&
      Math.abs(prev[1] - q[1]) < 1e-4 &&
      Math.abs(prev[2] - q[2]) < 1e-4 &&
      Math.abs(prev[3] - q[3]) < 1e-4
    ) {
      return;
    }
    this.store.setState({ spacecraftQuat: [q[0], q[1], q[2], q[3]] });
  }

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
      // wasdqe: free-fly; ,. roll; -= fov; rf dolly fwd/back; tg crane up/down.
      if (k.length !== 1 || !'wasdqe,.-=rftg'.includes(k)) return;
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

  // Analysis-engine tools. Each is a thin async wrapper that dynamically imports
  // ./analysis-ops.ts (the code-split boundary) and delegates to the standalone op,
  // passing the engine's core, store, and disposed guard. The dynamic import keeps the
  // heavy @bessel analysis packages out of the first-paint chunk; they load on first use.
  // The op functions own the loud-error and disposed handling.

  /** Lighting analysis: the spacecraft's umbra intervals over a day. */
  async computeEclipse(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeEclipse(e, this.store, this.isDisposed, opts);
  }

  /** Range analysis: the spacecraft-to-center-body distance over a day. */
  async computeRange(opts: AnalysisTargetSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeRange(e, this.store, this.isDisposed, opts);
  }

  /** Communications analysis: downlink Eb/N0 from the spacecraft to Earth over a day. */
  async computeLinkBudget(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeLinkBudget(e, this.store, this.isDisposed, opts);
  }

  /** Access analysis: line-of-sight windows from the spacecraft to a target over a day. */
  async computeAccess(opts: AnalysisTargetSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeAccessTool(e, this.store, this.isDisposed, opts);
  }

  /** Conjunction analysis: closest approach plus a 2D Pc on the loaded pair. */
  async computeConjunction(opts: { secondary?: string } = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeConjunction(e, this.store, this.isDisposed, opts);
  }

  /** Constellation design: a Walker Delta 24/3/1 LEO pattern (mission-independent). */
  async computeConstellation(): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.computeConstellation(this.store);
  }

  /** Attitude analysis: a nadir-to-Sun eigen-axis slew as a slew-angle series. */
  async computeSlew(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeSlew(e, this.store, this.isDisposed);
  }

  /** Maneuver design: a Lambert transfer departure delta-v on the loaded orbit. */
  async computeTransfer(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeTransfer(e, this.store, this.isDisposed);
  }

  /** Ground-track analysis: sub-spacecraft longitude/latitude over a day. */
  async computeGroundTrack(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeGroundTrack(e, this.store, this.isDisposed, opts);
  }

  /** Interoperability: export the spacecraft trajectory as a CCSDS OEM (KVN) download. */
  async exportOem(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.exportOem(e, this.store);
  }

  /** Propagation: SGP4 the bundled sample TLE and read it back as altitude + track. */
  async propagateTle(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.propagateTle(e, this.store, this.isDisposed, this.tleState);
  }

  /** Ground-station access: passes of the last-propagated satellite over Goldstone. */
  async computeStationAccess(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.computeStationAccess(e, this.store, this.isDisposed, this.tleState);
  }

  /** Numerical (HPOP) propagation: Cowell-integrate the TLE state and plot altitude. */
  async propagateHpop(model: HpopForceModel = 'j2'): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.propagateHpop(e, this.store, this.isDisposed, this.tleState, model);
  }

  /** Mission-design workbench: run a small MCS and draw the arc plus a DC report. */
  async runMcsDesign(design: McsDesign): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.runMcsDesign(e, this.store, this.isDisposed, design);
  }

  /** Orbit-determination workbench: a batch-least-squares recovery on synthetic data. */
  async runOd(noiseScale: number): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.runOd(this.store, this.isDisposed, noiseScale);
  }

  /** Data-provider workbench: evaluate any provider over a grid into a report table. */
  async runReport(cfg: ReportConfig): Promise<void> {
    const e = this.core;
    if (!e) return;
    const ops = await import('./analysis-ops.ts');
    return ops.runReport(e, this.store, this.isDisposed, cfg);
  }

  /** Set the base camera mode (orbit / sync / free / frame); track overrides it live. */
  setCameraMode(mode: 'orbit' | 'sync' | 'free' | 'frame'): void {
    this.store.setState({ cameraMode: mode });
    // Apply to the scene now (not just next frame) so any mode conversion happens
    // before a follow-up setView (e.g. a preset) and is not clobbered.
    if (!this.store.getState().track) this.core?.scene.setCameraMode(mode);
    if (mode !== 'sync') this.core?.scene.setSyncFrame(null);
    if (mode !== 'frame') {
      this.core?.scene.setCameraFrame(null);
      this.cameraFrameName = '';
    }
  }

  /** Pick the SPICE frame the camera basis locks to in 'frame' mode (e.g. IAU_MARS). */
  setCameraFrame(frame: string): void {
    const trimmed = frame.trim();
    if (!trimmed) return;
    this.store.setState({ cameraFrame: trimmed });
    // Clear the stale rotation so the next frame recomputes from the new frame.
    if (trimmed !== this.cameraFrameName) {
      this.cameraFrameName = '';
      this.core?.scene.setCameraFrame(null);
    }
  }

  /** Dolly the camera forward (+) or back (-) along the view axis (Cosmographia). */
  dolly(forwardFraction: number): void {
    this.core?.scene.dollyBy(forwardFraction);
  }

  /** Crane the camera up (+) or down (-) (Cosmographia craneUp / craneDown). */
  crane(upFraction: number): void {
    this.core?.scene.craneBy(upFraction);
  }

  /**
   * Apply continuous camera input from currently-held keys each frame: roll
   * (, / .), FOV / telephoto (- / =) in any mode, dolly (R / F) and crane (T / G)
   * in any non-track mode, and free-fly translation (WASD + Q/E) in free mode.
   */
  private applyCameraKeys(dt: number): void {
    const e = this.core;
    if (!e || this.heldKeys.size === 0) return;
    const k = this.heldKeys;
    const mode = e.scene.cameraMode;
    // Roll is only expressed in orbit/sync/frame, so only feed it there (avoids
    // silently accumulating roll in track/free that would snap in on return).
    if (mode === 'orbit' || mode === 'sync' || mode === 'frame') {
      const roll = (k.has(',') ? 1 : 0) - (k.has('.') ? 1 : 0);
      if (roll) e.scene.rollBy(roll * dt * 1.2);
    }
    const fov = (k.has('-') ? 1 : 0) - (k.has('=') ? 1 : 0);
    if (fov) e.scene.fovBy(1 + fov * dt * 0.9);
    // Dolly (along the view axis) and crane (vertical). Available in every mode
    // except track, which owns the camera placement from the velocity.
    if (mode !== 'track') {
      const dolly = (k.has('r') ? 1 : 0) - (k.has('f') ? 1 : 0);
      if (dolly) e.scene.dollyBy(dolly * dt * 1.2);
      const crane = (k.has('t') ? 1 : 0) - (k.has('g') ? 1 : 0);
      if (crane) e.scene.craneBy(crane * dt * 1.2);
    }
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

  // Refresh the arbitrary SPICE frame->J2000 rotation feeding 'frame' camera mode
  // (throttled worker pxform). Unlike sync (which is the focus body's IAU frame),
  // this locks the camera basis to any frame the user picks (e.g. IAU_EARTH or a
  // mission frame). An unresolvable frame falls back to plain orbit (frame=null),
  // never a silent identity rotation. Camera-relative: only a basis rotation, the
  // floating-origin shift is unchanged.
  private updateCameraFrame(dt: number, et: number, frame: string): void {
    const e = this.core;
    if (!e || !frame) return;
    this.frameAccum += dt;
    if (frame !== this.cameraFrameName) {
      this.cameraFrameName = frame;
      e.scene.setCameraFrame(null);
    }
    if (this.frameAccum < 0.1) return;
    this.frameAccum = 0;
    void e.spice.pxform(frame, 'J2000', et).then(
      (rot) => {
        const s = this.store.getState();
        if (!this.disposed && s.cameraMode === 'frame' && s.cameraFrame === frame) {
          e.scene.setCameraFrame(rot);
        }
      },
      () => {
        // Frame not resolvable at this epoch (no kernels / typo): plain orbit.
        if (!this.disposed) e.scene.setCameraFrame(null);
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
    else if (key === 'realImagery' && value) void this.applyRealImagery();
  }

  // Fetch and apply real equirectangular imagery to every body in the current
  // scene that has a known-body default or an explicit catalog URL. The texture
  // manager (and the decode path) is dynamically imported so it stays out of the
  // first-paint shell; bodies keep their procedural map until a real image
  // arrives, and a genuine fetch/decode failure is logged loudly (never a silent
  // wrong render). Camera-relative rendering is untouched: only the diffuse map
  // changes. Turning the toggle off leaves applied imagery in place; it is not
  // re-applied on a scene rebuild unless the setting is still on (see boot).
  private realImageryStarted = false;
  private async applyRealImagery(): Promise<void> {
    const e = this.core;
    if (!e || this.realImageryStarted) return;
    this.realImageryStarted = true;
    try {
      const { createWebTextureManager } = await import('../texture-imagery.ts');
      const manager = await createWebTextureManager();
      // Capture body names now; the data-real-imagery flag flips once at least one
      // body has swapped to a real map, so an e2e can assert the path was taken.
      let applied = 0;
      await Promise.all(
        e.scene.bodyNames().map(async (name) => {
          try {
            const tex = await manager.loadForBody(name);
            if (tex && !this.disposed && e.scene.setBodyTexture(name, tex)) applied += 1;
          } catch (err) {
            // One body's imagery failing must not abort the rest; log it loudly.
            console.error(`real imagery for ${name} failed`, err);
          }
        }),
      );
      if (!this.disposed && applied > 0) this.store.setState({ realImageryApplied: true });
    } catch (err) {
      console.error('real imagery unavailable', err);
    } finally {
      this.realImageryStarted = false;
    }
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
      // Texture-fidelity flags surfaced to the viewport for e2e/HUD: whether any
      // ring drew an image texture, and whether a cloud shell was built.
      const ringTextured = (mission.spec.rings ?? []).some((r) => !!r.texture);
      const cloudShell = e.scene.cloudShellPresent();
      // Swap the live mission state the frame loop reads each tick.
      e.table = mission.table;
      e.identity = mission.identity;
      e.instrument = await loadInstrument(e.spice, mission.instrument ?? null);
      this.startTelemetry();
      const [et0, et1] = mission.window;
      e.clock.setEpoch(et0);
      // Timeline annotations are derived here, where SPICE lives: arc boundaries
      // plus a SPICE-found closest approach. They flow to the viewer as inert data.
      const annotations = await buildMissionAnnotations(
        e.spice,
        catalog.spacecraft?.[0] ?? null,
        mission.identity.centerBody,
        mission.table,
        mission.window,
      );
      this.store.setState({
        bounds: [et0, et1],
        et: et0,
        focus: mission.identity.centerBody,
        selection: [mission.identity.centerBody],
        footprintPoints: 0,
        fovOk: !!e.instrument,
        annotations,
        spacecraftQuat: null,
        telemetryOverlay: [],
        telemetryFault: null,
        ringTextured,
        cloudShell,
        realImageryApplied: false,
        status: 'Ready',
      });
      // A scene rebuild creates fresh procedural materials, so re-apply real
      // imagery to the new bodies if the toggle is on (it is otherwise lost).
      if (this.store.getState().settings.realImagery) void this.applyRealImagery();
    } catch (err) {
      this.store.setState({ status: 'Ready', loadError: formatLoadError(err) });
    }
  }

  // The canned guided tour, expressed in the same cosmoscripting line grammar the
  // console interprets, so the tour and the console share one execution path.
  private static readonly TOUR_SCRIPT = ['setTimeRate 3600', 'unpause', 'viewFromSun'].join('\n');

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
    this.runScript(BesselEngine.TOUR_SCRIPT);
  }

  // Interpret a cosmoscripting-style program (one verb per line) against the live
  // viewer and return the per-line echo plus any first-failing-line error, which
  // the scripting console renders.
  runScript(source: string): ScriptResult {
    return runScript(source, createScript(this, this.store));
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
