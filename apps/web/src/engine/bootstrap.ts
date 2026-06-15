// The async boot sequence: load kernels through pal-web, build the mission scene
// spec from the catalog plus SPICE (mission orchestrator), apply it to the
// camera-relative scene through the scene-builder seam, load the instrument FOV,
// and reconstruct any shared view from the URL fragment. It updates store status
// as it goes and returns the imperative core the engine drives each frame.

import { createWebPlatform } from '@bessel/pal-web';
import { SolarSystemScene, buildScene } from '@bessel/scene';
import type { SpiceEngine } from '@bessel/spice';
import { Clock } from '@bessel/timeline';
import { decodeView } from '@bessel/state';
import { connectSpice } from '../spice.ts';
import { KERNEL_ORDER, KERNEL_URLS } from '../kernels.ts';
import type { EphemerisTable } from '../sampler.ts';
import { buildMissionScene } from '../mission.ts';
import { CASSINI_ISS_WAC, loadInstrumentFov, type InstrumentFov } from '../instruments.ts';
import type { AppStore } from '../store/index.ts';

export interface EngineCore {
  scene: SolarSystemScene;
  clock: Clock;
  table: EphemerisTable;
  spice: SpiceEngine;
  fov: InstrumentFov | null;
}

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

  const mission = await buildMissionScene(spice, (status) => store.setState({ status }));

  const scene = new SolarSystemScene(canvas);
  buildScene(scene, mission.spec);
  if (mission.spacecraftModel) scene.setSpacecraftModel(mission.spacecraftModel);

  const fov = await loadInstrumentFov(spice, CASSINI_ISS_WAC).catch((err: unknown) => {
    console.error('getfov failed', err);
    return null;
  });
  store.setState({ fovOk: !!fov });

  const [et0, et1] = mission.window;
  const clock = new Clock(et0, store.getState().rate);
  store.setState({ bounds: [et0, et1], et: et0 });

  await applySharedView(scene, clock, spice, store, isDisposed);

  return { scene, clock, table: mission.table, spice, fov };
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
    if (view.t) {
      const sharedEt = await spice.str2et(view.t.replace('Z', ''));
      if (isDisposed()) return;
      clock.setEpoch(sharedEt);
      store.setState({ et: sharedEt });
    }
    if (view.camera.target) scene.centerOn(view.camera.target);
    scene.setView(view.camera.azimuth, view.camera.elevation, view.camera.distance);
    store.setState({
      focus: view.camera.target ?? scene.focusBody,
      selection: view.selection,
    });
  } catch (err) {
    console.error('failed to apply shared view', err);
  }
}
