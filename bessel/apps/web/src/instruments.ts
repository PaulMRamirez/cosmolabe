// Thin app-side adapter over the core sensor geometry in @bessel/sensors: the FOV
// read, cone rim, and SPICE ellipsoid footprint now live in core (testable, reusable)
// and this module only adapts the plain tuples to the scene's branded Km3 type and
// fixes the app's cone-length cap. (STK_PARITY_SPEC §4.7.)
import type { SpiceEngine } from '@bessel/spice';
import type { Km3 } from '@bessel/scene';
import {
  fovConeRim,
  footprintFromFov,
  loadInstrumentFov,
  type FootprintContext,
  type InstrumentFov,
} from '@bessel/sensors';

export { loadInstrumentFov };
export type { InstrumentFov, FootprintContext };

// The cone is a bounded pointing indicator: extending it all the way to a target
// millions of km away makes it fill the view edge-on. Cap the length so it reads as a
// cone from the spacecraft; when the target is close the cap exceeds the range so the
// cone still reaches the surface near the footprint.
const FOV_CONE_MAX_KM = 350_000;

/** FOV cone rim points (km, heliocentric) emanating from the spacecraft toward the target. */
export function fovRim(spacecraftKm: Km3, targetKm: Km3, fov: InstrumentFov): Km3[] {
  return fovConeRim(spacecraftKm, targetKm, fov, FOV_CONE_MAX_KM) as Km3[];
}

/**
 * Observation footprint: surface points (J2000, relative to the target center, km)
 * where the FOV corner rays intercept the target ellipsoid. Empty on a limb crossing.
 */
export async function footprint(
  spice: SpiceEngine,
  et: number,
  fov: InstrumentFov,
  ctx: FootprintContext,
): Promise<Km3[]> {
  return (await footprintFromFov(spice, et, fov, ctx)) as Km3[];
}
