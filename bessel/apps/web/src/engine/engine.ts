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
  type TimeSystem,
} from '@bessel/ui';
import { encodeView, decodeView, TelemetryAdapter, type ViewModel } from '@bessel/state';
import type { BesselCatalog } from '@bessel/catalog';
import { positionAt, velocityAt, rangeRate } from '../sampler.ts';
import { resolveTwoVector } from '../trajectory/twovector.ts';
import { fovRim, footprint } from '../instruments.ts';
import { toggleSelection, rollMeasurePair } from '../selection.ts';
import { parseAnyCatalog, formatLoadError, DEFAULT_OBJECT_ENTRIES } from '../catalog-load.ts';
import { buildCatalogMissionScene } from '../generic-mission.ts';
import { buildMissionAnnotations } from './mission-annotations.ts';
import { createScript } from '../scripting.ts';
import { runScript, type ScriptResult } from '../script-runner.ts';
import { MockTelemetrySocket } from '../telemetry-mock.ts';
import { loadWelcomeSeen, persistWelcomeSeen } from '../welcome.ts';
import {
  loadBookmarks,
  persistBookmarks,
  parseBookmarkList,
  newBookmarkId,
  type Bookmark,
} from '../bookmarks.ts';
import { loadSavedScripts, persistSavedScripts, upsertScript } from '../scripts.ts';
import {
  KEPT_SNAPSHOT_LIMIT,
  DEFAULT_VISUALIZATION_SETTINGS,
  type AppStore,
  type AnalysisContext,
  type AnalyzeTab,
  type RunStatus,
  type SpacecraftSource,
  type GroundStation,
} from '../store/index.ts';
import {
  buildSnapshotMetrics,
  buildSnapshotLabel,
  kindDomain,
  type SnapshotKind,
} from './snapshot-metrics.ts';
import { reduceStations, type StationAction } from '../panels/station-registry.ts';
import type {
  AccessConstraintSpec,
  FovPointingMode,
  LinkWorksheetSpec,
  SlewFeasibilitySpec,
  ObservationScheduleSpec,
} from './analysis-defaults.ts';
import { bootScene, loadInstrument, type EngineCore } from './bootstrap.ts';
import type { GrammarJobKind } from '../store/app-state.ts';
import type { GrammarRef } from './grammar-ops.ts';
import { applyViewModel } from './apply-view.ts';
import { type HpopForceModel } from './hpop-model.ts';
import { type McsDesign } from './mcs.ts';
import { type EditableMcs } from './mcs-editor.ts';
import type {
  AnalysisSpan,
  AnalysisTargetSpan,
  LinkBudgetOpts,
  ConjunctionOpts,
  ConstellationParams,
  SlewOpts,
  ReportConfig,
  TleState,
  ScreeningRef,
  ConstellationRef,
  CoverageRef,
  CoverageSweepOpts,
  // [ux-p1-conjunction] the ingested-catalog ref + ingest-format/screen-opts types.
  ConjunctionCatalogRef,
  IngestFormat,
  IngestScreenOpts,
  // [ux-p2-conjunction] the analyst-supplied covariance input type.
  SuppliedCovarianceInput,
  // [ux-p2-orbit] the configurable Lambert porkchop sweep parameters.
  PorkchopParams,
  // [ux-p3-conjunction] the dedicated porkchop-worker client ref.
  PorkchopRef,
} from './analysis-ops.ts';

// True when two optional angles are equal or both absent (within tolerance).
function anglesClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}
import { pushEpochLabel, pushReadouts, pushBodyState, pushBoundsLabels } from './telemetry.ts';
import { centerMu } from './center-mu.ts';
import { RATE_STEPS } from './constants.ts';

/** IAU body-fixed frame name for a body, for sync-orbit (e.g. Earth -> IAU_EARTH). */
function iauFrameFor(body: string): string {
  return `IAU_${body.toUpperCase()}`;
}

/**
 * Reduce a kernel name to a single safe OPFS path segment. The name can come from a
 * URL's last segment or a plugin manifest, so a value like '../../evil' must never be
 * interpolated into /kernels/${name} where it could escape the kernels directory.
 * Drops any directory portion, then strips characters outside a conservative
 * allowlist; a name that reduces to empty (or a lone dot run) hashes to a stable
 * fallback so two different escaping names do not collide on the same file.
 */
export function safeKernelPathSegment(name: string): string {
  // Keep only the final path component, so '../a/b.bsp' becomes 'b.bsp'.
  const base = name.split(/[\\/]/).pop() ?? '';
  // Allowlist letters, digits, dot, dash, underscore; replace everything else.
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  // A name that is empty or only dots ('', '.', '..') has no usable segment; derive a
  // stable, collision-resistant fallback from the original string.
  if (cleaned === '' || /^\.+$/.test(cleaned)) {
    let hash = 5381;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 33) ^ name.charCodeAt(i);
    return `kernel-${(hash >>> 0).toString(16)}`;
  }
  return cleaned;
}

const preventDefault = (ev: Event): void => ev.preventDefault();

// The analysis-engine request shapes (AnalysisSpan, AnalysisTargetSpan, ReportConfig)
// live in ./analysis-ops.ts alongside the operations that consume them, so importing
// the analysis packages stays behind the dynamic-import split boundary. The provider
// kind is needed eagerly only as a type on the ReportConfig surface.
export type {
  AnalysisSpan,
  AnalysisTargetSpan,
  LinkBudgetOpts,
  ConjunctionOpts,
  ConstellationParams,
  SlewOpts,
  ReportConfig,
  CoverageSweepOpts,
  PorkchopParams,
} from './analysis-ops.ts';

/** The outcome of a share/copy action: the link, and whether it reached the clipboard. */
export interface ShareResult {
  readonly url: string;
  readonly copied: boolean;
}

/** Where a catalog to load comes from: a fetchable URL or an already-read file. */
export type CatalogSource =
  | { readonly url: string }
  | { readonly file: { readonly name: string; readonly text: string } };

export class BesselEngine {
  private core: EngineCore | null = null;
  // The single boot promise, so a load triggered before boot finishes awaits the
  // same in-flight boot instead of racing a null core (the boot-vs-click bug).
  private bootPromise: Promise<void> | null = null;
  private raf = 0;
  private lastTs = 0;
  private snapSeq = 0;
  private labelAccum = 0;
  // Throttles the live et store write during playback to the label cadence so the
  // unmemoized viewer does not reconcile its whole tree per frame; wasPlaying lets
  // the loop flush the exact stopped epoch once when playback ends.
  private etAccum = 0;
  private wasPlaying = false;
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
  // The dedicated conjunction-screening worker client, lazily constructed on first screen
  // (inside the dynamic-import op so the worker chunk stays off the first-paint shell) and
  // reused/cancelled across runs. A mutable ref so the lazily-imported screening ops own it.
  private readonly screeningRef: ScreeningRef = { client: null };
  // [ux-p3-conjunction] The dedicated porkchop-sweep worker client, lazily constructed on first
  // sweep (inside the dynamic-import op so the worker chunk stays off the first-paint shell) and
  // reused/cancelled across runs, mirroring screeningRef.
  private readonly porkchopRef: PorkchopRef = { client: null };
  // [ux-p1-conjunction] The most recently ingested REAL conjunction catalog (CDM/OEM/TLE) +
  // per-object covariances, shared by the ingest/screen/per-event-Pc ops across separate
  // dynamic-import calls. Null until the first ingestion.
  private readonly conjunctionCatalogRef: ConjunctionCatalogRef = { result: null, supplied: new Map() };
  // The designed-constellation sequence + published asset SPK ids, shared by the (lazily
  // imported) coverage ops so the Walker design FEEDS the sweep across separate dynamic-import
  // calls: designConstellation publishes the asset set into it; sweepCoverage reads it.
  private readonly constellationRef: ConstellationRef = { seq: 0, assetIds: [] };
  // [ux-p3-coverage] The dedicated coverage-sweep worker client, lazily constructed on first
  // sweep (inside the dynamic-import op so the coverage worker chunk stays off the first-paint
  // shell) and reused/cancelled across runs. A mutable ref the lazily-imported coverage ops own.
  private readonly coverageRef: CoverageRef = { client: null };
  /** M-0008 grammar demo: the compute worker client and in-flight job runs. */
  private readonly grammarRef: {
    client: { dispose(): void } | null;
    et0: number;
    runs: Map<GrammarJobKind, { cancel(): void }>;
  } = { client: null, et0: 0, runs: new Map() };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly store: AppStore,
  ) {}

  private readonly isDisposed = (): boolean => this.disposed;

  // Idempotent: the first call starts boot, later calls (e.g. from loadCatalog)
  // await the same in-flight promise. This is what lets a pre-boot load render
  // once the core exists instead of silently no-op'ing against a null core.
  boot(): Promise<void> {
    return (this.bootPromise ??= this.runBoot());
  }

  private async runBoot(): Promise<void> {
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
      this.refreshBoundsLabels();
      void this.loadBookmarksFromStorage();
      void this.loadWelcomeSeenFromStorage();
      void this.loadSavedScriptsFromStorage();
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
    // Terminate any in-flight screening / porkchop workers so they do not outlive the engine.
    this.screeningRef.client?.cancel();
    this.porkchopRef.client?.cancel();
    // [ux-p3-coverage] Terminate any in-flight coverage worker (and its nested SPICE worker) too.
    this.coverageRef.client?.dispose();
    // Terminate the grammar demo's compute worker (M-0008).
    this.grammarRef.client?.dispose();
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

    // Camera mode: tracking overrides the user's base mode (orbit, sync-orbit, or
    // free) while it is on; otherwise the base mode applies. The tracked object is
    // the current focus (set by centerOn, so trackObject Saturn follows Saturn, not
    // the spacecraft), as long as it has an ephemeris in the sampled table.
    const scName = e.identity.spacecraftName;
    const trackName = e.table.byBody.has(e.scene.focusBody)
      ? e.scene.focusBody
      : scName && e.table.byBody.has(scName)
        ? scName
        : null;
    if (s.track && trackName) {
      e.scene.setFocusVelocity(velocityAt(e.table, trackName, now));
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
    } else if (att?.kind === 'twovector') {
      // TwoVector (C18): resolve the two reference directions at the current epoch
      // (a worker round-trip per target direction), build the body-to-inertial
      // rotation, and orient the model. Throttled like the CK path since the
      // directions move slowly relative to the frame rate.
      this.attitudeAccum += dt;
      if (this.attitudeAccum > 0.2) {
        this.attitudeAccum = 0;
        const spec = att.spec;
        void resolveTwoVector(e.spice, spec, now).then(
          (rot) => {
            if (this.disposed) return;
            e.scene.setSpacecraftAttitude(rot);
            this.publishSpacecraftQuat(rowMajor3x3ToQuaternion(rot));
          },
          (err: unknown) => {
            // A direction that cannot be resolved at this epoch (no ephemeris): keep
            // the last orientation rather than snapping the model.
            console.error('TwoVector attitude resolve failed', err);
          },
        );
      }
    }

    e.scene.render(dt);

    // Advance the timeline value during playback, but throttle the store write to
    // the ~4Hz label cadence rather than writing every frame. The unmemoized viewer
    // reads et with useStore, so a 60fps write reconciled the whole menus/dock/
    // workbench tree per frame; ~4Hz keeps the scrubber moving without that cost.
    // The scene itself already animates from e.clock every frame, independent of this.
    // On the frame where playback just stopped, flush once so the scrubber lands on
    // the exact stopped epoch instead of the last throttled value.
    if (s.playing) {
      this.etAccum += dt;
      if (this.etAccum > 0.25) {
        this.etAccum = 0;
        this.store.setState({ et: now });
      }
    } else if (this.wasPlaying) {
      this.store.setState({ et: now });
    }
    this.wasPlaying = s.playing;
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
      pushReadouts(e.spice, this.store, focus, observer, now, e.bodyFrames, this.isDisposed);
      // State vectors and osculating elements: the focused body about its center
      // (the Sun when the focus is itself the mission center), in the chosen frame.
      // Only computed when the inspector State panel is on screen (a selection exists,
      // or Measure mode is active); otherwise the SPICE work would feed nothing.
      if (s.selection.length > 0 || s.measureMode) {
        const center = focus === e.identity.centerBody ? 'Sun' : e.identity.centerBody;
        // Recompute only when an input changed: while paused on a fixed focus and frame
        // this skips the spkezr + element work that would otherwise repeat every tick.
        const stateKey = `${focus}|${center}|${s.stateFrame}|${now}`;
        if (stateKey !== this.lastStateKey) {
          this.lastStateKey = stateKey;
          void this.centerMuCached(center).then((mu) => {
            if (!this.disposed) pushBodyState(e.spice, this.store, focus, center, s.stateFrame, now, mu, this.isDisposed);
          });
        }
      }
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
    if (!id) return;
    // In Measure mode a click builds the measured pair (rolling two picks) rather
    // than recentering the camera; otherwise it frames the picked body as before.
    if (this.store.getState().measureMode) this.addToMeasurePair(id);
    else this.centerOn(id);
  }

  // Add a picked id to the measured pair, keeping only the most recent two distinct
  // picks so a third click rolls the oldest body out of the measurement.
  private addToMeasurePair(id: string): void {
    this.store.setState((s) => ({ selection: rollMeasurePair(s.selection, id) }));
  }

  /** Enter or leave Measure mode (canvas clicks build the measured pair). */
  toggleMeasureMode(): void {
    this.store.setState((s) => ({ measureMode: !s.measureMode }));
  }

  /** Clear the current multi-object selection (and so the active measurement). */
  clearSelection(): void {
    this.store.setState({ selection: [] });
  }

  /** Close the selection inspector: drop the selection and leave Measure mode in one
   *  action, so the header close is a single, discoverable dismiss. */
  closeInspector(): void {
    this.store.setState({ selection: [], measureMode: false });
  }

  /** Acknowledge the current telemetry fault so the banner hides until a new
   *  (different) fault string is raised. */
  acknowledgeFault(): void {
    this.store.setState((s) => ({ acknowledgedFault: s.telemetryFault }));
  }

  /** Show or hide the live-geometry readout strip (independent of camera state). */
  setShowLiveGeometry(show: boolean): void {
    this.store.setState({ showLiveGeometry: show });
  }

  /** Restore the layer/visualization settings to their canonical defaults. */
  resetSettings(): void {
    this.store.setState({ settings: { ...DEFAULT_VISUALIZATION_SETTINGS } });
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

  // Every compute/run/export action runs through runTool, keyed by the action id (which
  // is the panel button's data-testid), so each tool transitions idle -> running -> ok
  // or { error } and the panel can show a busy state and a located success or failure.
  /** M-0008 grammar demo: run one of the four product-kind jobs through the
   *  compute worker; partials stream into the grammar store slice and the
   *  scene drapes. */
  async runGrammarJob(kind: GrammarJobKind): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool(`grammar-${kind}`, async () => {
      const ops = await import('./grammar-ops.ts');
      await ops.runGrammarJob(e, this.store, this.grammarRef as GrammarRef, kind);
    });
  }

  /** Cancel an in-flight grammar job cooperatively (JobHandle.cancel). */
  cancelGrammarJob(kind: GrammarJobKind): void {
    this.grammarRef.runs.get(kind)?.cancel();
  }

  private async runTool(id: string, fn: () => Promise<void> | void): Promise<void> {
    this.setRunStatus(id, 'running');
    try {
      await fn();
      if (!this.disposed) this.setRunStatus(id, 'ok');
    } catch (err) {
      if (!this.disposed) {
        this.setRunStatus(id, { error: err instanceof Error ? err.message : String(err) });
      }
      console.error(`tool ${id} failed`, err);
    }
  }

  private setRunStatus(id: string, status: RunStatus): void {
    this.store.setState((s) => ({ runStatus: { ...s.runStatus, [id]: status } }));
  }

  /** Keep the current result of an analysis result block as a typed compare snapshot (Wave 2B:
   *  generalized so EVERY result block across the six domain panels can be kept). The snapshot
   *  carries its domain, a label, and the decision-relevant metrics for that result kind. A no-op
   *  when the result is not present yet or the tray is already full. */
  keepSnapshot(kind: SnapshotKind): void {
    const metrics = buildSnapshotMetrics(kind, this.store.getState());
    if (!metrics) return;
    const domain = kindDomain(kind);
    const seq = (this.snapSeq += 1);
    const keptAt = this.store.getState().et;
    const label = buildSnapshotLabel(kind, this.store.getState(), seq);
    const snapshot = { id: `snap-${seq}`, domain, label, metrics, keptAt };
    // One functional update that re-checks the limit against the freshest state: two
    // rapid keeps must not both read a stale length and append past the cap. A no-op
    // (return the same array) when the tray is already full.
    this.store.setState((s) =>
      s.keptSnapshots.length >= KEPT_SNAPSHOT_LIMIT
        ? { keptSnapshots: s.keptSnapshots }
        : { keptSnapshots: [...s.keptSnapshots, snapshot] },
    );
  }

  /** Remove a kept snapshot by id. */
  removeSnapshot(id: string): void {
    this.store.setState((s) => ({ keptSnapshots: s.keptSnapshots.filter((k) => k.id !== id) }));
  }

  /** Clear the compare tray. */
  clearSnapshots(): void {
    this.store.setState({ keptSnapshots: [] });
  }

  /** Lighting analysis: the spacecraft's full umbra/penumbra/annular/sunlit eclipse
   *  phases over a day (the lighting ops load with the lazy analysis chunk). */
  async computeEclipse(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-eclipse', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeEclipsePhases(e, this.store, this.isDisposed, opts);
    });
  }

  /** Beta-angle season analysis: the solar beta angle (deg) over the span plus the
   *  body's eclipse-onset threshold (lighting ops load with the lazy analysis chunk). */
  async computeBetaSeries(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-beta', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeBetaSeries(e, this.store, this.isDisposed, opts);
    });
  }

  /** Solar-intensity analysis: the visible solar-disk fraction (0..1) over the span
   *  (lighting ops load with the lazy analysis chunk). */
  async computeSolarIntensity(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-solar-intensity', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeSolarIntensity(e, this.store, this.isDisposed, opts);
    });
  }

  /** Range analysis: the spacecraft-to-center-body distance over a day. */
  async computeRange(opts: AnalysisTargetSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-range', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeRange(e, this.store, this.isDisposed, opts);
    });
  }

  /** Communications analysis: downlink Eb/N0 from the spacecraft to Earth over a day. */
  async computeLinkBudget(opts: LinkBudgetOpts = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-link', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeLinkBudget(e, this.store, this.isDisposed, opts);
    });
  }

  /** Composable access stack: run the assembled constraint array (line-of-sight, range,
   *  range-rate, sun keep-out) and store the surviving window plus a per-constraint breakdown. */
  async computeAccessStack(
    spec: AccessConstraintSpec,
    opts: AnalysisTargetSpan = {},
  ): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-access', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeAccessStack(e, this.store, this.isDisposed, spec, opts.target, opts);
    });
  }

  /** Selectable-pointing in-FOV sweep: FOV-only windows plus the post-constraint surviving
   *  window for the chosen boresight pointing mode (nadir or sun). */
  async computeFovWindows(
    pointing: FovPointingMode,
    spec: AccessConstraintSpec,
    opts: AnalysisTargetSpan = {},
  ): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-fov', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeFovWindows(e, this.store, this.isDisposed, pointing, spec, opts.target, opts);
    });
  }

  /** [ux-p2-access] Az/el-masked station passes of the tracked spacecraft over the ACTIVE
   *  registered ground station, each reduced to its max-elevation epoch + the slant ranges the
   *  link worksheet binds to. UNGATES the Phase-1 az/el-mask constraint against a real station. */
  async computeStationPasses(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-station-passes', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeStationPasses(e, this.store, this.isDisposed, opts);
    });
  }

  /** [ux-p2-access] Select the active station pass the link worksheet binds to (active-selection:
   *  the producing passes card writes selectedPassId, the consuming worksheet card reads it). */
  setSelectedPass(passId: string | null): void {
    this.store.setState({ selectedPassId: passId });
  }

  /** [ux-p2-access] Select the consecutive pass pair the slew-feasibility card binds to (active-
   *  selection: two pass ids), or null to clear. */
  setSelectedWindowPair(pair: readonly [string, string] | null): void {
    this.store.setState({ selectedWindowPair: pair });
  }

  /** [ux-p2-access] Assemble the itemized link-budget worksheet at the worst-case AND nominal
   *  elevation of the SELECTED pass (or a representative geometry), with a margin-vs-time series. */
  async computeLinkWorksheet(spec: LinkWorksheetSpec): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-link-worksheet', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeLinkWorksheet(e, this.store, this.isDisposed, spec);
    });
  }

  /** [ux-p2-access] Decide whether the eigen-axis slew between the SELECTED consecutive pass pair's
   *  pointings fits in the inter-pass gap (target-track or inertial mode). */
  async computeSlewFeasibility(spec: SlewFeasibilitySpec): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-slew-feasibility', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeSlewFeasibility(e, this.store, this.isDisposed, spec);
    });
  }

  /** [ux-p3-access] Build a conflict-free multi-target observation schedule: per-target in-FOV +
   *  constraint windows assembled into an ordered, non-overlapping timeline where the attitude slew
   *  between consecutive targets fits the gap, plus any unscheduled (conflicted) targets. */
  async computeObservationSchedule(
    spec: ObservationScheduleSpec,
    constraints: AccessConstraintSpec,
    opts: { spanSec?: number; stepSec?: number } = {},
  ): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-observation-schedule', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeObservationSchedule(e, this.store, this.isDisposed, spec, constraints, opts);
    });
  }

  /** Conjunction analysis: closest approach plus a 2D Pc on the loaded pair. */
  async computeConjunction(opts: ConjunctionOpts = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-conjunction', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeConjunction(e, this.store, this.isDisposed, opts);
    });
  }

  /** Cancel an in-flight catalog screen (terminates the worker) and reset the run status. */
  async cancelScreen(): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.cancelScreen(this.store, this.screeningRef);
    this.setRunStatus('screen-catalog', 'idle');
  }

  /** [ux-p1-conjunction] Ingest REAL CDM/OEM/TLE text into the conjunction screening catalog.
   *  The pure parse loads with the lazy ops; a malformed input fails loud as a located error. */
  async ingestConjunctionCatalog(format: IngestFormat, text: string): Promise<void> {
    await this.runTool('ingest-catalog', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.ingestConjunctionCatalog(this.store, this.conjunctionCatalogRef, format, text);
    });
  }

  /** [ux-p1-conjunction] Screen the INGESTED catalog on the dedicated worker (same progress/
   *  cancel UX as the synthetic screen), with configurable thresholdKm/padKm. */
  async screenIngestedCatalog(opts: IngestScreenOpts = {}): Promise<void> {
    await this.runTool('screen-catalog', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.screenIngestedCatalog(
        this.store,
        this.isDisposed,
        this.screeningRef,
        this.conjunctionCatalogRef,
        opts,
      );
    });
  }

  /** [ux-p1-conjunction] Per-event full-covariance Pc + Max-Pc + B-plane geometry for the
   *  selected screened event (by index), from the ingested per-object covariances. */
  async computeEventPc(index: number): Promise<void> {
    await this.runTool('compute-event-pc', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.computeEventPc(this.store, this.conjunctionCatalogRef, index);
    });
  }

  /** [ux-p2-conjunction] Supply an analyst-assumed covariance for an object whose ingested format
   *  carried none (OEM/TLE), then recompute the selected event Pc. Fails loud on a non-PD matrix. */
  async setSuppliedCovariance(objectId: string, input: SuppliedCovarianceInput): Promise<void> {
    await this.runTool('supply-covariance', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.setSuppliedCovariance(this.store, this.conjunctionCatalogRef, objectId, input);
    });
  }

  /** [ux-p2-conjunction] Clear an analyst-supplied covariance for an object and recompute. */
  async clearSuppliedCovariance(objectId: string): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.clearSuppliedCovariance(this.store, this.conjunctionCatalogRef, objectId);
  }

  /** [ux-p2-conjunction] Export the selected conjunction event as a CCSDS-CDM-style KVN record
   *  (TCA, miss, relative state, Pc, covariance) through the unified export path. */
  async exportEventCdm(): Promise<void> {
    await this.runTool('export-cdm', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.exportEventCdm(this.store);
    });
  }

  /** Constellation design: generate a Walker pattern, publish each satellite as an SPK
   *  ASSET, and render one orbit ring per plane so the design FEEDS the coverage sweep.
   *  The heavy propagation/publish loads with the lazy coverage ops. Defaults to 24/3/1 LEO. */
  async computeConstellation(params?: ConstellationParams): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-constellation', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.designConstellation(
        e,
        this.store,
        this.isDisposed,
        this.constellationRef,
        params ?? ops.DEFAULT_CONSTELLATION,
      );
    });
  }

  /** Coverage sweep: sweep the designed asset set (or the loaded spacecraft) over a
   *  configurable grid, color the draped overlay by the SELECTED FOM metric (camera-relative),
   *  and write the regional FOM summary. The heavy sweep + overlay build load with the lazy ops. */
  async computeCoverageGrid(opts: CoverageSweepOpts = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-coverage-grid', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.sweepCoverage(e, this.store, this.isDisposed, this.constellationRef, this.coverageRef, opts);
    });
  }

  /** [ux-p3-coverage] Cancel an in-flight coverage sweep (terminates the worker) and reset the
   *  run status + progress slice (mirrors cancelScreen). */
  async cancelCoverageGrid(): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.cancelCoverageSweep(this.store, this.coverageRef);
    this.setRunStatus('compute-coverage-grid', 'idle');
  }

  /** Clear the draped coverage overlay (and its summary readout). */
  async clearCoverageGrid(): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('clear-coverage-grid', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.clearCoverageGrid(e, this.store);
    });
  }

  /** Attitude analysis: an eigen-axis slew between two pointing modes as a slew-angle series. */
  async computeSlew(opts: SlewOpts = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-slew', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeSlew(e, this.store, this.isDisposed, opts);
    });
  }

  /** Maneuver design: a Lambert transfer departure delta-v on the loaded orbit. */
  async computeTransfer(): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-transfer', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeTransfer(e, this.store, this.isDisposed);
    });
  }

  /** [ux-p2-orbit] Maneuver design: a Lambert PORKCHOP sweep over a departure-epoch and
   *  time-of-flight grid, publishing the delta-v contour and the marked minimum. [ux-p3-conjunction]
   *  The CPU-bound grid solve runs on a dedicated cancellable worker (porkchopRef) with progress. */
  async computePorkchop(params: PorkchopParams): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-porkchop', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computePorkchop(e, this.store, this.isDisposed, this.porkchopRef, params);
    });
  }

  /** [ux-p3-conjunction] Cancel an in-flight porkchop sweep (terminates the worker) and reset the
   *  run status, mirroring cancelScreen. */
  async cancelPorkchop(): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.cancelPorkchop(this.store, this.porkchopRef);
    this.setRunStatus('compute-porkchop', 'idle');
  }

  /** [ux-p2-orbit] Cross-tab carrier: append the porkchop's marked optimum to the editable MCS
   *  as an impulsive Maneuver, so the designer flows porkchop -> MCS without re-typing the burn. */
  async sendPorkchopToMcs(): Promise<void> {
    await this.runTool('send-to-mcs', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.sendPorkchopToMcs(this.store);
    });
  }

  /** [ux-p2-wave2b] Cross-tab carrier: write the OD estimate's covariance into the Conjunction
   *  supplied-covariance store for `objectId`, then switch to the Conjunction tab, so the SSA
   *  analyst gets the OD covariance into the per-event Pc without re-typing. Fails loud (surfaced
   *  through runStatus) when there is no OD result, no ingested catalog, or no selected event. */
  async sendOdCovarianceToConjunction(objectId: string): Promise<void> {
    await this.runTool('od-to-conjunction', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.sendOdCovarianceToConjunction(this.store, this.conjunctionCatalogRef, objectId);
      this.setAnalyzeTab('conjunction');
    });
  }

  /** [ux-p2-wave2b] Cross-tab carrier: seed an impulsive avoidance Maneuver in the editable MCS
   *  from the selected conjunction event, then switch to the Orbit & Maneuver tab. The rescreen
   *  loop is Phase 3; here the candidate burn is only carried into the MCS builder. Fails loud
   *  when no event is selected. */
  async planAvoidanceBurn(): Promise<void> {
    await this.runTool('plan-avoidance-burn', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.planAvoidanceBurn(this.store);
      this.setAnalyzeTab('orbit-maneuver');
    });
  }

  /** [ux-p3-conjunction] Close the maneuver-then-rescreen loop: apply the MCS-solved avoidance burn
   *  to the selected event's primary, re-screen it against the catalog, and publish the BEFORE vs
   *  AFTER Pc comparison (and update the pair's watchlist row). Fails loud when there is no selected
   *  event or ingested catalog. */
  async rescreenAfterManeuver(): Promise<void> {
    await this.runTool('rescreen-after-maneuver', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.rescreenAfterManeuver(this.store, this.conjunctionCatalogRef);
    });
  }

  /** [ux-p3-conjunction] Add the selected conjunction event's pair to the watchlist (seeded with its
   *  current Pc + miss). Fails loud when no event is selected. */
  async watchSelectedEvent(): Promise<void> {
    await this.runTool('watch-event', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.watchSelectedEvent(this.store);
    });
  }

  /** [ux-p3-conjunction] Remove a watched pair from the watchlist by its row key. */
  async unwatchEvent(key: string): Promise<void> {
    const ops = await import('./analysis-ops.ts');
    ops.unwatchEvent(this.store, { type: 'unwatch', key });
  }

  /** Ground-track analysis: sub-spacecraft longitude/latitude over a day. */
  async computeGroundTrack(opts: AnalysisSpan = {}): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-groundtrack', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeGroundTrack(e, this.store, this.isDisposed, opts);
    });
  }

  /** Interoperability: export the spacecraft trajectory as a CCSDS OEM (KVN) download. */
  async exportOem(): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('export-oem', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.exportOem(e, this.store);
    });
  }

  /** Set the editable spacecraft source the propagation tools read (a pasted TLE or a picked
   *  scene object), mirroring its display name into scenario.primarySpacecraft so other tabs
   *  share the same role-primary selection. Pass null to clear the source. */
  setSpacecraftSource(source: SpacecraftSource | null): void {
    this.store.setState((s) => ({
      scenario: { ...s.scenario, spacecraftSource: source, primarySpacecraft: source ? source.name : null },
    }));
  }

  /** Propagation: SGP4 the active TLE source and read it back as altitude + track. */
  async propagateTle(): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('propagate-tle', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.propagateTle(e, this.store, this.isDisposed, this.tleState);
    });
  }

  /** Ground-station access: passes of the last-propagated satellite over Goldstone. */
  async computeStationAccess(): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('compute-station-access', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.computeStationAccess(e, this.store, this.isDisposed, this.tleState);
    });
  }

  /** Numerical (HPOP) propagation: Cowell-integrate the TLE state and plot altitude. */
  async propagateHpop(model: HpopForceModel = 'j2'): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('propagate-hpop', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.propagateHpop(e, this.store, this.isDisposed, this.tleState, model);
    });
  }

  /** Mission-design workbench: run a small fixed-shape MCS (the legacy 4-scalar design) and
   *  draw the arc plus a DC report. Kept for callers that still pass a scalar McsDesign. */
  async runMcsDesign(design: McsDesign): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('run-mcs', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.runMcsDesign(e, this.store, this.isDisposed, design);
    });
  }

  /** Editable mission-design workbench: compile and run the user-built MCS segment list,
   *  draw the solved arc, and surface the residual trace + solved delta-v (run-mcs testid). */
  async runEditableMcs(design: EditableMcs): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('run-mcs', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.runEditableMcsDesign(e, this.store, this.isDisposed, design);
    });
  }

  /** Orbit-determination workbench: a batch-least-squares recovery on synthetic data. */
  async runOd(noiseScale: number): Promise<void> {
    await this.runTool('run-od', async () => {
      const ops = await import('./analysis-ops.ts');
      ops.runOd(this.store, this.isDisposed, noiseScale);
    });
  }

  /** Data-provider workbench: evaluate any provider over a grid into a report table. */
  async runReport(cfg: ReportConfig): Promise<void> {
    const e = this.core;
    if (!e) return;
    await this.runTool('run-report', async () => {
      const ops = await import('./analysis-ops.ts');
      await ops.runReport(e, this.store, this.isDisposed, cfg);
    });
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

  async share(): Promise<ShareResult> {
    const view = await this.buildViewModel();
    if (!view) return { url: window.location.href, copied: false };
    window.location.hash = encodeView(view);
    const url = window.location.href;
    let copied = false;
    try {
      await navigator.clipboard?.writeText(url);
      copied = navigator.clipboard != null;
    } catch {
      // Clipboard may be unavailable; the URL hash is still updated and the caller
      // surfaces the link in a selectable field instead.
      copied = false;
    }
    return { url, copied };
  }

  /** Build a shareable link to a single saved view from its stored hash, or null. */
  bookmarkLink(id: string): string | null {
    const b = this.store.getState().bookmarks.find((x) => x.id === id);
    if (!b) return null;
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#${b.hash}`;
  }

  /** Copy a saved view's link to the clipboard; returns the link + whether it copied. */
  async copyBookmarkLink(id: string): Promise<ShareResult | null> {
    const url = this.bookmarkLink(id);
    if (!url) return null;
    let copied = false;
    try {
      await navigator.clipboard?.writeText(url);
      copied = navigator.clipboard != null;
    } catch {
      copied = false;
    }
    return { url, copied };
  }

  /** Download the saved-views list as a JSON document. */
  exportBookmarks(): void {
    const blob = new Blob([JSON.stringify(this.store.getState().bookmarks, null, 2)], {
      type: 'application/json',
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'bessel-saved-views.json';
    a.click();
    URL.revokeObjectURL(href);
  }

  /** Import saved views from a JSON document, merging by id. Throws loudly on bad JSON. */
  async importBookmarks(json: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    const incoming = parseBookmarkList(json);
    const byId = new Map(this.store.getState().bookmarks.map((b) => [b.id, b] as const));
    for (const b of incoming) byId.set(b.id, b);
    const next = [...byId.values()];
    this.store.setState({ bookmarks: next });
    await persistBookmarks(e.storage, next);
  }

  private async loadBookmarksFromStorage(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const bookmarks = await loadBookmarks(e.storage);
    if (!this.disposed) this.store.setState({ bookmarks });
  }

  private async loadSavedScriptsFromStorage(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const savedScripts = await loadSavedScripts(e.storage);
    if (!this.disposed) this.store.setState({ savedScripts });
  }

  /** Save (or replace) a named script and persist the list through PAL Storage. */
  async saveScript(name: string, source: string): Promise<void> {
    const e = this.core;
    if (!e || !name.trim()) return;
    const next = upsertScript(this.store.getState().savedScripts, name.trim(), source);
    this.store.setState({ savedScripts: next });
    await persistSavedScripts(e.storage, next);
  }

  /** Delete a named script and persist the trimmed list. */
  async deleteScript(name: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    const next = this.store.getState().savedScripts.filter((s) => s.name !== name);
    this.store.setState({ savedScripts: next });
    await persistSavedScripts(e.storage, next);
  }

  private async loadWelcomeSeenFromStorage(): Promise<void> {
    const e = this.core;
    if (!e) return;
    const seen = await loadWelcomeSeen(e.storage);
    if (!this.disposed && seen) this.store.setState({ welcomeSeen: true });
  }

  /** Close the welcome card for this session. When `optOut` is true the user asked not
   *  to see it again, so persist that preference (otherwise it returns on the next open). */
  async dismissWelcome(optOut = false): Promise<void> {
    this.store.setState({ welcomeDismissed: true });
    if (optOut && !this.store.getState().welcomeSeen) {
      this.store.setState({ welcomeSeen: true });
      const e = this.core;
      if (e) await persistWelcomeSeen(e.storage);
    }
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

  /** Jump the clock to a typed epoch, parsed via SPICE and clamped to the bounds.
   *  Fails loudly: a bad string sets a typed timelineError and leaves the clock put. */
  async goToEpoch(text: string): Promise<void> {
    const e = this.core;
    const trimmed = text.trim();
    if (!e || !trimmed) return;
    try {
      const et = await e.spice.str2et(trimmed);
      if (this.disposed) return;
      const [lo, hi] = this.store.getState().bounds;
      this.store.setState({ timelineError: null });
      this.scrub(Math.max(lo, Math.min(hi, et)));
    } catch (err) {
      this.store.setState({
        timelineError: `Could not parse epoch "${trimmed}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  toggleTrack(): void {
    const next = !this.store.getState().track;
    this.store.setState({ track: next });
    const sc = this.core?.identity.spacecraftName;
    if (next && sc) this.centerOn(sc);
  }

  /** Set tracking on or off without re-centering, so the frame loop follows the
   *  current focus (used by trackObject to track a named target, not the spacecraft). */
  setTracking(on: boolean): void {
    this.store.setState({ track: on });
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

  /** Switch the active instrument by name: reload its FOV so the cone, footprint, and
   *  the in-FOV tool all track the chosen sensor. No-op when the name is unknown. */
  async setActiveInstrument(name: string): Promise<void> {
    const e = this.core;
    if (!e) return;
    const descriptor = e.instruments.find((i) => i.name === name);
    if (!descriptor) return;
    e.instrument = await loadInstrument(e.spice, descriptor);
    if (this.disposed) return;
    this.store.setState({ activeInstrumentId: descriptor.name, fovOk: !!e.instrument });
  }

  togglePlay(): void {
    this.store.setState((s) => ({ playing: !s.playing }));
  }

  setRate(rate: number): void {
    this.store.setState({ rate });
  }

  /** Switch the displayed epoch time system (display only) and re-derive the label. */
  setTimeSystem(system: TimeSystem): void {
    this.store.setState({ timeSystem: system });
    const e = this.core;
    if (e) pushEpochLabel(e.spice, this.store, e.clock.state.et, this.isDisposed);
    // The window-bound labels are in the same time system, so re-format them too.
    this.refreshBoundsLabels();
  }

  // The central-body GM is a physical constant for a given center, so the per-tick
  // state readout caches it rather than re-querying the kernel pool (a worker
  // round-trip) every tick. Cleared when a new mission loads.
  private readonly muCache = new Map<string, number | null>();
  // The last (focus|center|frame|et) the body-state readout computed for, so an
  // unchanged tick (e.g. paused) skips the spkezr + element recompute.
  private lastStateKey = '';

  private async centerMuCached(center: string): Promise<number | null> {
    const cached = this.muCache.get(center);
    if (cached !== undefined) return cached;
    const e = this.core;
    if (!e) return null;
    const mu = await centerMu(e, center);
    this.muCache.set(center, mu);
    return mu;
  }

  /** Re-format the loaded window's start/end labels (active time system) for the scrub
   *  track. Fire-and-forget; reads the current bounds from the store. */
  private refreshBoundsLabels(): void {
    const e = this.core;
    if (!e) return;
    const [lo, hi] = this.store.getState().bounds;
    pushBoundsLabels(e.spice, this.store, lo, hi, this.isDisposed);
  }

  /** Set the SPICE frame the State panel reports r/v and elements in. The next
   *  readout tick recomputes; clear the stale state so the panel does not flash an
   *  old frame's numbers under the new label. */
  setStateFrame(frame: string): void {
    this.store.setState({ stateFrame: frame, bodyState: null });
  }

  /** Open or close the consolidated Analyze dock (it does not auto-dismiss). */
  toggleAnalyze(): void {
    this.store.setState((s) => ({ analyzeOpen: !s.analyzeOpen }));
  }

  /** Select an Analyze dock tab, opening the dock if it is closed. */
  setAnalyzeTab(tab: AnalyzeTab): void {
    this.store.setState(() => ({ analyzeOpen: true, analyzeTab: tab }));
  }

  /** Patch the shared analysis context (span, step, target, observer, frame). */
  setAnalysisContext(patch: Partial<AnalysisContext>): void {
    this.store.setState((s) => ({ analysisContext: { ...s.analysisContext, ...patch } }));
  }

  /** [ux-p2-access] Dispatch a ground-station registry action (add / update / remove / select)
   *  against the scenario slice through the pure reducer. Stations are first-class shared context
   *  the access/comms/observation cards read by role; a malformed station fails loud (the reducer
   *  throws a located StationRegistryError, which surfaces through runStatus). */
  dispatchStation(action: StationAction): void {
    void this.runTool('station-registry', () => {
      this.store.setState((s) => ({ scenario: reduceStations(s.scenario, action) }));
    });
  }

  /** [ux-p2-access] Convenience: add a ground station to the registry (and make it active). */
  addStation(station: GroundStation): void {
    this.dispatchStation({ kind: 'add', station });
  }

  /** [ux-p2-access] Convenience: select (or clear, with null) the active ground station. */
  selectStation(id: string | null): void {
    this.dispatchStation({ kind: 'select', id });
  }

  /** [ux-p2-access] Convenience: remove a ground station from the registry by id. */
  removeStation(id: string): void {
    this.dispatchStation({ kind: 'remove', id });
  }

  /** [ux-f30] Convenience: overwrite a station by id (edit in place; rejects unknown id). */
  updateStation(station: GroundStation): void {
    this.dispatchStation({ kind: 'update', station });
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
      // The dynamic import or texture-manager bootstrap failed: clear the guard so a
      // later toggle can retry. On success the guard stays set so a repeated toggle
      // does not re-import the manager and re-fetch every texture. A scene rebuild
      // (renderMission) clears the guard explicitly, since fresh procedural
      // materials genuinely need re-texturing.
      this.realImageryStarted = false;
      console.error('real imagery unavailable', err);
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

  // Load a catalog from a URL or an already-read file, then render it. Awaits boot
  // first, so a load triggered before the scene core exists renders once boot
  // finishes instead of silently no-op'ing (the boot-vs-click race). On a
  // parse/render failure a located error is shown loudly and the "loaded" label is
  // NOT set (CLAUDE.md: never a silent fallback, never lie about state).
  async loadCatalog(source: CatalogSource): Promise<void> {
    await this.boot();
    if (!this.core) {
      this.store.setState({ loadError: 'Engine failed to start; cannot load a catalog' });
      return;
    }
    let file;
    try {
      file = await this.resolveCatalogSource(source);
    } catch (err) {
      this.store.setState({ loadError: formatLoadError(err) });
      return;
    }
    let loaded;
    try {
      loaded = await parseAnyCatalog(file.name, file.text);
    } catch (err) {
      this.store.setState({ loadError: formatLoadError(err) });
      return;
    }

    // A catalog (native or imported from Cosmographia) with a spacecraft time
    // window rebuilds the 3D scene; a bodies-only catalog (no window to sample
    // over) updates only the object list. The object list and "loaded" label are
    // committed only after a successful build, so a failed render never leaves the
    // UI claiming a mission is loaded over the untouched neutral scene.
    const hasWindow = !!loaded.catalog?.spacecraft?.[0]?.arcs?.[0]?.timeRange;
    if (loaded.catalog && hasWindow && !(await this.renderMission(loaded.catalog))) {
      return;
    }
    this.store.setState({ objects: loaded.entries, loadedName: loaded.name, loadError: null });
  }

  // Resolve a catalog source to its name and text: fetch a URL, or pass an
  // already-read file straight through. A failed fetch throws (shown loudly).
  private async resolveCatalogSource(
    source: CatalogSource,
  ): Promise<{ name: string; text: string }> {
    if ('file' in source) return source.file;
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Catalog not found at ${source.url} (${res.status})`);
    const text = await res.text();
    const name = source.url.split('/').pop() ?? source.url;
    return { name, text };
  }

  // Rebuild the rendered scene from a parsed native catalog. Returns true when the
  // scene was rebuilt, false when the build failed (a located error is set) or the
  // engine was disposed mid-build; the caller commits the object list only on true.
  private async renderMission(catalog: BesselCatalog): Promise<boolean> {
    const e = this.core;
    if (!e) return false;
    try {
      this.store.setState({ status: 'Building mission' });
      const mission = await buildCatalogMissionScene(
        e.spice,
        catalog,
        (status) => this.store.setState({ status }),
        e.fs,
      );
      if (this.disposed) return false;
      e.scene.reset();
      buildScene(e.scene, mission.spec);
      if (mission.spacecraftModel) e.scene.setSpacecraftModel(mission.spacecraftModel);
      // Texture-fidelity flags surfaced to the viewport for e2e/HUD: whether any
      // ring drew an image texture, and whether a cloud shell was built.
      const ringTextured = (mission.spec.rings ?? []).some((r) => !!r.texture);
      const cloudShell = e.scene.cloudShellPresent();
      // Resolve the instrument (a yielding await) BEFORE committing any live mission
      // state, then swap table/identity/bodyFrames/instruments/instrument in one
      // synchronous block. Committing the table/identity first and awaiting the
      // instrument afterward would let a frame in the gap pair the new positions with
      // the previous instrument's FOV/footprint. The disposed re-check covers a
      // dispose during this await.
      const loadedInstrument = await loadInstrument(e.spice, mission.instrument ?? null);
      if (this.disposed) return false;
      e.table = mission.table;
      e.identity = mission.identity;
      e.bodyFrames = mission.bodyFrames;
      e.instruments = mission.instruments;
      e.instrument = loadedInstrument;
      // A new mission may furnish different GM constants; drop the cached values.
      this.muCache.clear();
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
        instrumentNames: mission.instruments.map((i) => i.name),
        activeInstrumentId: e.instrument?.descriptor.name ?? null,
        annotations,
        spacecraftQuat: null,
        telemetryOverlay: [],
        telemetryFault: null,
        ringTextured,
        cloudShell,
        realImageryApplied: false,
        status: 'Ready',
      });
      this.refreshBoundsLabels();
      // A scene rebuild creates fresh procedural materials, so re-apply real imagery
      // to the new bodies if the toggle is on (it is otherwise lost). Clear the
      // once-only guard first: this rebuild genuinely needs re-texturing, unlike a
      // repeated toggle on an unchanged scene (which the guard correctly blocks).
      this.realImageryStarted = false;
      if (this.store.getState().settings.realImagery) void this.applyRealImagery();
      return true;
    } catch (err) {
      this.store.setState({ status: 'Ready', loadError: formatLoadError(err) });
      return false;
    }
  }

  // Unload the active catalog and return to the neutral inner-solar-system scene,
  // mirroring Cosmographia's File > Unload Last Catalog. Furnished kernels stay
  // loaded (SPICE has no per-kernel unfurnsh here); only the rendered objects and
  // scene reset.
  unloadCatalog(): void {
    const e = this.core;
    this.stopTelemetry();
    if (e) {
      e.scene.reset();
      e.identity = { ...e.identity, spacecraftName: null };
      // Drop the unloaded mission's frames and instruments so they cannot leak into
      // the neutral scene.
      e.bodyFrames = new Map();
      e.instruments = [];
      e.instrument = null;
    }
    this.store.setState({
      objects: [...DEFAULT_OBJECT_ENTRIES],
      loadedName: null,
      loadError: null,
      telemetryResidualKm: null,
      instrumentNames: [],
      activeInstrumentId: null,
      fovOk: false,
      status: 'Ready',
    });
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
    // Sanitize the OPFS path segment so a name carrying '../' (from a URL tail or a
    // plugin manifest) cannot escape the /kernels directory when persisted.
    const segment = safeKernelPathSegment(name);
    await e.fs.writeFile(`/kernels/${segment}`, bytes).catch((err: unknown) => {
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
