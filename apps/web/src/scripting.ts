// Scripting API (item 6, Cosmographia cosmoscripting parity). A small, chainable
// facade that drives the viewer (camera, time, selection, layers, capture) from
// code, for demos, guided tours, deterministic e2e setups, and the in-app
// scripting console. BesselScript depends only on a narrow ScriptHost, so its
// verbs are unit-testable with a recording mock; the concrete host is assembled
// from the engine and store by createScriptHost.

import type { SettingKey } from '@bessel/ui';
import type { BesselEngine } from './engine/index.ts';
import type { AppStore } from './store/index.ts';

/** Camera frame mode, mirroring the cosmoscripting inertial/synodic verbs. */
export type ScriptFrame = 'orbit' | 'sync' | 'free';

export interface ScriptHost {
  gotoObject(name: string): void;
  gotoHome(): void;
  select(ids: readonly string[]): void;
  setRate(rate: number): void;
  setPlaying(playing: boolean): void;
  setTime(et: number): void;
  getTime(): number;
  track(name: string): void;
  untrack(): void;
  setFrame(mode: ScriptFrame): void;
  setLayer(key: SettingKey, on: boolean): void;
  setObjectVisible(id: string, visible: boolean): void;
  screenshot(): void;
  toggleRecording(on: boolean): void;
  note(text: string): void;
  loadCatalog(url: string): void;
  viewFromSun(): void;
  viewAlongVelocity(): void;
}

/**
 * Chainable scripting surface, mirroring the Cosmographia cosmoscripting verbs
 * (gotoObject, gotoHome, setTime, setTimeRate, pause/unpause, track, frame, show/
 * hide layers and objects, screenshot, record, note, loadCatalog, plus camera
 * vectors). Each method returns this so a tour reads as a sequence of calls.
 */
export class BesselScript {
  constructor(private readonly host: ScriptHost) {}

  /** Center the camera on a body or the spacecraft by name. */
  gotoObject(name: string): this {
    this.host.gotoObject(name);
    return this;
  }

  /** Return to the default whole-system (home) view. */
  gotoHome(): this {
    this.host.gotoHome();
    return this;
  }

  /** Select one or more objects (drives measurement and the inspector). */
  select(...ids: string[]): this {
    this.host.select(ids);
    return this;
  }

  /** Set the playback rate (simulated seconds per wall-clock second). */
  setTimeRate(rate: number): this {
    this.host.setRate(rate);
    return this;
  }

  pause(): this {
    this.host.setPlaying(false);
    return this;
  }

  unpause(): this {
    this.host.setPlaying(true);
    return this;
  }

  /** Alias for unpause, matching the cosmoscripting verb. */
  play(): this {
    return this.unpause();
  }

  /** Jump the clock to an ephemeris time (TDB seconds). */
  setTime(et: number): this {
    this.host.setTime(et);
    return this;
  }

  /** Read the current ephemeris time (TDB seconds). */
  getTime(): number {
    return this.host.getTime();
  }

  /** Track an object so the camera follows it (cosmoscripting trackObject). */
  track(name: string): this {
    this.host.track(name);
    return this;
  }

  /** Stop tracking and return to the orbit camera. */
  untrack(): this {
    this.host.untrack();
    return this;
  }

  /** Set the camera frame: orbit (inertial), sync (synodic), or free. */
  setFrame(mode: ScriptFrame): this {
    this.host.setFrame(mode);
    return this;
  }

  /** Show a visualization layer (trajectory, orbits, labels, ...). */
  show(key: SettingKey): this {
    this.host.setLayer(key, true);
    return this;
  }

  /** Hide a visualization layer. */
  hide(key: SettingKey): this {
    this.host.setLayer(key, false);
    return this;
  }

  /** Show a catalog object by id (cosmoscripting showObject). */
  showObject(id: string): this {
    this.host.setObjectVisible(id, true);
    return this;
  }

  /** Hide a catalog object by id (cosmoscripting hideObject). */
  hideObject(id: string): this {
    this.host.setObjectVisible(id, false);
    return this;
  }

  /** Capture a still image of the viewport (cosmoscripting saveScreenShot). */
  screenshot(): this {
    this.host.screenshot();
    return this;
  }

  /** Start recording video (cosmoscripting startRecordingVideoToFile). */
  record(): this {
    this.host.toggleRecording(true);
    return this;
  }

  /** Stop recording video (cosmoscripting stopRecordingVideo). */
  stopRecord(): this {
    this.host.toggleRecording(false);
    return this;
  }

  /** Display a note in the HUD (cosmoscripting displayNote). */
  note(text: string): this {
    this.host.note(text);
    return this;
  }

  /** Alias for note, matching the cosmoscripting verb name. */
  displayNote(text: string): this {
    return this.note(text);
  }

  /** Load a catalog file by URL (cosmoscripting loadCatalogFile). */
  loadCatalog(url: string): this {
    this.host.loadCatalog(url);
    return this;
  }

  /** Look from the Sun toward the focus (vector-set-view). */
  viewFromSun(): this {
    this.host.viewFromSun();
    return this;
  }

  /** Look down the spacecraft velocity. */
  viewAlongVelocity(): this {
    this.host.viewAlongVelocity();
    return this;
  }
}

/** Build a ScriptHost backed by the live engine and store. */
export function createScriptHost(engine: BesselEngine, store: AppStore): ScriptHost {
  return {
    gotoObject: (name) => engine.centerOn(name),
    gotoHome: () => engine.viewTopDown(),
    select: (ids) => store.setState({ selection: [...ids] }),
    setRate: (rate) => engine.setRate(rate),
    setPlaying: (playing) => store.setState({ playing }),
    setTime: (et) => engine.scrub(et),
    getTime: () => store.getState().et,
    track: (name) => {
      // Center on the named target first so the frame loop tracks it (the tracked
      // object is the current focus), then turn tracking on. Routing through
      // toggleTrack() would re-center on the spacecraft and discard the named target.
      engine.centerOn(name);
      engine.setTracking(true);
    },
    untrack: () => {
      if (store.getState().track) engine.toggleTrack();
    },
    setFrame: (mode) => engine.setCameraMode(mode),
    setLayer: (key, on) => engine.setSetting(key, on),
    setObjectVisible: (id, visible) => engine.toggleVisibleObject(id, visible),
    screenshot: () => engine.captureStill(),
    toggleRecording: (on) => {
      if (store.getState().recording !== on) engine.toggleRecording();
    },
    note: (text) => store.setState({ status: text }),
    loadCatalog: (url) => void engine.loadCatalog({ url }),
    viewFromSun: () => engine.viewFromSun(),
    viewAlongVelocity: () => engine.viewAlongVelocity(),
  };
}

/** Convenience: a BesselScript wired to the engine and store. */
export function createScript(engine: BesselEngine, store: AppStore): BesselScript {
  return new BesselScript(createScriptHost(engine, store));
}
