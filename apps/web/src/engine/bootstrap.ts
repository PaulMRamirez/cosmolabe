// The async boot sequence: load kernels through pal-web, build a neutral
// inner-solar-system scene from the generic catalog builder (no hardcoded
// mission), apply it to the camera-relative scene through the scene-builder
// seam, and reconstruct any shared view from the URL fragment. A mission (e.g.
// the Cassini sample) is loaded on demand via engine.loadCatalog. It updates
// store status as it goes and returns the imperative core the engine drives.

import { createWebPlatform } from '@bessel/pal-web';
import { SolarSystemScene, buildScene } from '@bessel/scene';
import type { SpiceComputeEngine, SpiceEngine } from '@bessel/spice';
import type { Storage, FileSystem } from '@bessel/pal';
import { Clock } from '@bessel/timeline';
import { decodeView } from '@bessel/state';
import { connectSpice } from '../spice.ts';
import { KERNEL_ORDER, KERNEL_URLS } from '../kernels.ts';
import type { EphemerisTable } from '../sampler.ts';
import {
  buildCatalogMissionScene,
  type MissionIdentity,
  type InstrumentDescriptor,
} from '../generic-mission.ts';
import { loadInstrumentFov, type InstrumentFov } from '../instruments.ts';
import type { AppStore } from '../store/index.ts';
import { applyViewModel } from './apply-view.ts';

/** An instrument descriptor plus its resolved FOV geometry. */
export interface LoadedInstrument {
  readonly descriptor: InstrumentDescriptor;
  readonly fov: InstrumentFov;
}

export interface EngineCore {
  scene: SolarSystemScene;
  clock: Clock;
  table: EphemerisTable;
  spice: SpiceComputeEngine;
  // The active mission's instrument, or null for a neutral or instrument-less
  // mission. Mutable so loading a new catalog re-points FOV and footprint.
  instrument: LoadedInstrument | null;
  // Every resolved instrument descriptor for the active mission, for the selector.
  instruments: readonly InstrumentDescriptor[];
  storage: Storage;
  fs: FileSystem;
  // The active mission's spacecraft and center body. Mutable so loading a new
  // catalog re-points the frame loop (track, FOV, footprint) without a hardcode.
  identity: MissionIdentity;
  // Body-name/id -> declared body-fixed frame, for illumination readouts. Mutable
  // so loading a new catalog re-points the frames; reset to empty on unload.
  bodyFrames: ReadonlyMap<string, string>;
}

/** The neutral boot scene: the inner solar system, no spacecraft or instrument. */
const NEUTRAL_CATALOG = { version: '1.0', name: 'Solar System' } as const;

export async function bootScene(
  canvas: HTMLCanvasElement,
  store: AppStore,
  isDisposed: () => boolean,
): Promise<EngineCore> {
  const spice = connectSpice();
  store.setState({ status: 'Loading kernels' });
  const platform = await createWebPlatform({ kernelUrls: KERNEL_URLS });
  for (const name of KERNEL_ORDER) {
    const handle = await platform.kernels.resolve(name);
    const bytes = await platform.kernels.read(handle);
    await spice.furnsh(name, bytes);
  }

  const mission = await buildCatalogMissionScene(
    spice,
    NEUTRAL_CATALOG,
    (status) => store.setState({ status }),
    platform.fs,
  );

  const scene = new SolarSystemScene(canvas);
  buildScene(scene, mission.spec);
  if (mission.spacecraftModel) scene.setSpacecraftModel(mission.spacecraftModel);

  const instrument = await loadInstrument(spice, mission.instrument ?? null);
  store.setState({ fovOk: !!instrument });

  const [et0, et1] = mission.window;
  const clock = new Clock(et0, store.getState().rate);
  store.setState({ bounds: [et0, et1], et: et0 });

  await applySharedView(scene, clock, spice, store, isDisposed);

  return {
    scene,
    clock,
    table: mission.table,
    spice,
    instrument,
    storage: platform.storage,
    fs: platform.fs,
    identity: mission.identity,
    instruments: mission.instruments,
    bodyFrames: mission.bodyFrames,
  };
}

/** Resolve a mission's instrument descriptor to a LoadedInstrument, or null. */
export async function loadInstrument(
  spice: SpiceEngine,
  descriptor: InstrumentDescriptor | null,
): Promise<LoadedInstrument | null> {
  if (!descriptor) return null;
  try {
    const fov = await loadInstrumentFov(spice, descriptor.sensorId);
    return { descriptor, fov };
  } catch (err) {
    console.error('getfov failed', err);
    return null;
  }
}

// Reconstruct a shared view from the URL fragment, if present.
async function applySharedView(
  scene: SolarSystemScene,
  clock: Clock,
  spice: SpiceEngine,
  store: AppStore,
  isDisposed: () => boolean,
): Promise<void> {
  if (window.location.hash.length <= 1) return;
  try {
    const view = decodeView(window.location.hash);
    await applyViewModel(scene, clock, spice, store, view, isDisposed);
  } catch (err) {
    console.error('failed to apply shared view', err);
  }
}
