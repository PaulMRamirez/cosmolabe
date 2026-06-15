// Mission orchestrator: reads a catalog, calls SPICE in the worker, and produces
// an inert SceneSpec (plus the ephemeris table the frame loop interpolates and
// the loaded spacecraft model). This is the seam where SPICE lives on the app
// side and @bessel/scene stays SPICE-free: scene-builder consumes only the spec.
//
// For Phase F0.3 this encodes the Cassini-at-Saturn demo as the first catalog
// the orchestrator drives. Phase B generalizes it to arbitrary loaded catalogs.

import { parseCosmographiaCatalog } from '@bessel/catalog';
import cassiniCatalog from '@bessel/catalog/examples/cassini';
import { INNER_SYSTEM, loadSpacecraftModel, parseStarCatalog, type SceneSpec } from '@bessel/scene';
import type { Object3D } from 'three';
import type { SpiceEngine } from '@bessel/spice';
import cassiniGltf from './assets/cassini.gltf?raw';
import brightStars from './assets/bright-stars.json';
import { sampleEphemeris, positionAt, trajectoryOf, type EphemerisTable } from './sampler.ts';
import { missionWindow } from './mission/duration.ts';
import { STEPS, FOCUS_DISTANCE } from './engine/constants.ts';

export interface MissionScene {
  readonly spec: SceneSpec;
  readonly table: EphemerisTable;
  readonly spacecraftModel: Object3D | null;
  readonly window: readonly [number, number];
}

export async function buildMissionScene(
  spice: SpiceEngine,
  onStatus: (status: string) => void,
): Promise<MissionScene> {
  const catalog = parseCosmographiaCatalog(cassiniCatalog);
  const spacecraftName = catalog.name;

  const rawEt0 = await spice.str2et(catalog.startTime ?? '2004-06-21T00:00:00');
  const rawEt1 = await spice.str2et(catalog.endTime ?? '2004-08-23T00:00:00');
  const [et0, et1] = missionWindow(rawEt0, rawEt1, 1800);

  onStatus('Sampling ephemerides');
  const sampleRefs = [
    ...INNER_SYSTEM.map((p) => ({ name: p.name, spiceId: p.spiceId })),
    { name: spacecraftName, spiceId: catalog.spiceId },
  ];
  const table = await sampleEphemeris(spice, sampleRefs, et0, et1, STEPS);
  // The orbit is sampled in the center body's frame so the trajectory shows the
  // orbit rather than the center body's heliocentric drift.
  const orbit = await sampleEphemeris(
    spice,
    [{ name: spacecraftName, spiceId: catalog.spiceId }],
    et0,
    et1,
    STEPS,
    catalog.center,
  );

  const saturnRot = await spice.pxform('IAU_SATURN', 'J2000', et0);
  const sunDir = positionAt(table, 'Saturn', et0);
  const scStart = positionAt(table, spacecraftName, et0);

  const spec: SceneSpec = {
    bodies: INNER_SYSTEM,
    spacecraft: { name: spacecraftName },
    trajectory: { points: trajectoryOf(orbit, spacecraftName), anchorBody: 'Saturn' },
    starField: safeStars(),
    rings: [{ body: 'Saturn', innerKm: 74500, outerKm: 140220, rotationRowMajor3x3: saturnRot }],
    axisTriads: [
      { id: 'saturn-axes', body: 'Saturn', rotationRowMajor3x3: saturnRot, lengthKm: 120000 },
    ],
    atmospheres: [
      {
        body: 'Saturn',
        innerKm: 60268,
        outerKm: 66000,
        sunDirection: [-sunDir[0], -sunDir[1], -sunDir[2]],
        visible: false,
      },
    ],
    directionVectors: [
      {
        anchorBody: spacecraftName,
        // Direction to the Sun (the Sun sits at the heliocentric origin).
        specs: [{ label: 'to-Sun', dirKm: [-scStart[0], -scStart[1], -scStart[2]], color: 0xffd27f }],
        lengthKm: 200000,
      },
    ],
    camera: { focus: 'Saturn', azimuth: 0.6, elevation: 0.35, distance: FOCUS_DISTANCE['Saturn'] ?? 0.7 },
  };

  const spacecraftModel = await loadSpacecraftModel(cassiniGltf, 200).catch((err: unknown) => {
    console.error('spacecraft model load failed', err);
    return null;
  });

  return { spec, table, spacecraftModel, window: [et0, et1] };
}

function safeStars(): ReturnType<typeof parseStarCatalog> | undefined {
  try {
    return parseStarCatalog(brightStars);
  } catch (err) {
    console.error('star catalog parse failed', err);
    return undefined;
  }
}
