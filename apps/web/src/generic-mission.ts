// Generic, catalog-driven mission scene builder. Where mission.ts encodes the
// bundled Cassini demo, this turns an arbitrary parsed native Bessel catalog
// into a SceneSpec by sampling SPICE for every referenced body and spacecraft
// and mapping each catalog geometry type onto the spec. This is the seam that
// makes "load any mission" real: engine.loadCatalog rebuilds the rendered scene
// from one of these rather than re-rendering Cassini.
//
// The geometry-mapping helpers are pure and headless-testable; the orchestrator
// does the SPICE sampling and calls them. Bodies and spacecraft resolve by SPICE
// name or id (spkpos accepts both), so a catalog body "Saturn" or "699" works as
// long as the loaded kernels cover it. Unresolved bodies fail loudly.

import {
  INNER_SYSTEM,
  loadSpacecraftModel,
  orbitEllipse,
  parseStarCatalog,
  type PlanetDef,
  type SceneSpec,
  type Km3,
  type Star,
  type RingSpec,
  type OrbitSpec,
  type AtmosphereSpec,
  type AxisTriadSpec,
  type DirectionVectorsSpec,
  type KeplerianSwarmSpec,
  type ParticleSystemSpec,
  type TimeSwitchedSpec,
} from '@bessel/scene';
import { linearRamp } from '@bessel/color';
import type {
  BesselCatalog,
  CatalogBody,
  CatalogInstrument,
  CatalogSpacecraft,
  Geometry,
} from '@bessel/catalog';
import type { SpiceEngine } from '@bessel/spice';
import type { Object3D } from 'three';
import brightStars from './assets/bright-stars.json';
import { sampleEphemeris, positionAt, trajectoryOf, type EphemerisTable } from './sampler.ts';
import { missionWindow } from './mission/duration.ts';
import { STEPS, FOCUS_DISTANCE, DEFAULT_FOCUS_DISTANCE } from './engine/constants.ts';

/** Default sampling window (UTC) for a neutral mission with no spacecraft arc. */
const DEFAULT_WINDOW: readonly [string, string] = ['2004-06-22T00:00:00', '2004-08-22T00:00:00'];

/** Sun gravitational parameter (km^3/s^2), the fallback when PCK GM is unavailable. */
const GM_SUN = 1.32712440018e11;

/** How the spacecraft model is oriented each frame, from the catalog. */
export type AttitudeSpec =
  | { readonly kind: 'spice'; readonly frame: string }
  | { readonly kind: 'fixed'; readonly quaternion: readonly [number, number, number, number] }
  | {
      readonly kind: 'uniform';
      readonly axis: readonly [number, number, number];
      readonly ratePerSec: number;
      readonly epochEt: number;
    };

/** Which spacecraft and center body the active mission tracks. */
export interface MissionIdentity {
  readonly spacecraftName: string | null;
  /** Spacecraft SPICE id (the observer for readouts), e.g. "-82", if any. */
  readonly spacecraftId?: string;
  readonly centerBody: string;
  /** Spacecraft attitude source (CK frame, fixed quaternion, or uniform spin). */
  readonly attitude?: AttitudeSpec;
}

/** A catalog-declared instrument resolved to the ids the FOV/footprint code needs. */
export interface InstrumentDescriptor {
  /** Sensor SPICE id for getfov, e.g. -82361. */
  readonly sensorId: number;
  /** Observer (spacecraft) SPICE id for sincpt, e.g. "-82". */
  readonly observerId: string;
  /** Target body SPICE id for getfov/sincpt, e.g. "699". */
  readonly targetId: string;
  /** Target body-fixed frame for sincpt, e.g. "IAU_SATURN". */
  readonly targetFrame: string;
  /** Table key the FOV cone and footprint anchor to (a body name, e.g. "Saturn"). */
  readonly anchorName: string;
}

export interface MissionScene {
  readonly spec: SceneSpec;
  readonly table: EphemerisTable;
  readonly window: readonly [number, number];
  readonly identity: MissionIdentity;
  /** Loaded glTF spacecraft model, if the spacecraft declares a Mesh geometry. */
  readonly spacecraftModel?: Object3D | null;
  /** The first catalog instrument, resolved, or null if the mission has none. */
  readonly instrument?: InstrumentDescriptor | null;
}

const INNER_BY_NAME = new Map(INNER_SYSTEM.map((p) => [p.name.toLowerCase(), p]));

const DEFAULT_BODY_COLOR: readonly [number, number, number] = [0.6, 0.62, 0.66];
const DEFAULT_BODY_RADIUS_KM = 1000;

/** Mean radius (km) for a catalog body: explicit Globe radii, else a known body, else a default. */
export function bodyRadiusKm(body: CatalogBody): number {
  const g = body.geometry;
  if (g && g.type === 'Globe' && g.radii && g.radii.length === 3) {
    return (g.radii[0]! + g.radii[1]! + g.radii[2]!) / 3;
  }
  const known = INNER_BY_NAME.get((body.name ?? body.id).toLowerCase());
  return known?.radiusKm ?? DEFAULT_BODY_RADIUS_KM;
}

/** Turn a catalog body into the PlanetDef the globe renderer consumes. */
export function catalogBodyToPlanetDef(body: CatalogBody): PlanetDef {
  const name = body.name ?? body.id;
  const known = INNER_BY_NAME.get(name.toLowerCase());
  const g = body.geometry;
  const texture = g && g.type === 'Globe' ? g.texture : undefined;
  const normalMap = g && g.type === 'Globe' ? g.normalMap : undefined;
  return {
    name,
    spiceId: body.id,
    radiusKm: bodyRadiusKm(body),
    color: known?.color ?? DEFAULT_BODY_COLOR,
    ...(texture ? { texture } : {}),
    ...(normalMap ? { normalMap } : {}),
  };
}

/** A Rings geometry (or a Globe carrying a rings sub-spec) maps to a RingSpec. */
export function ringSpecFromGeometry(
  body: string,
  g: Geometry,
  rotationRowMajor3x3?: readonly number[],
): RingSpec | null {
  const rings = g.type === 'Rings' ? g : g.type === 'Globe' ? g.rings : undefined;
  if (!rings) return null;
  const innerKm = rings.innerRadius ?? 0;
  const outerKm = rings.outerRadius ?? 0;
  if (outerKm <= innerKm) return null;
  return {
    body,
    innerKm,
    outerKm,
    ...(rotationRowMajor3x3 ? { rotationRowMajor3x3 } : {}),
    ...(rings.texture ? { texture: rings.texture } : {}),
  };
}

/** A KeplerianSwarm geometry maps to a swarm spec with sensible default orbit spread. */
export function swarmSpecFromGeometry(
  id: string,
  anchorBody: string,
  g: Geometry,
  semiMajorRefKm: number,
  rotationRowMajor3x3?: readonly number[],
): KeplerianSwarmSpec | null {
  if (g.type !== 'KeplerianSwarm') return null;
  const color = typeof g.color === 'string' ? g.color : '#bcd4ff';
  return {
    id,
    anchorBody,
    ...(rotationRowMajor3x3 ? { rotationRowMajor3x3 } : {}),
    params: {
      count: 1200,
      semiMajorMinKm: semiMajorRefKm * 1.6,
      semiMajorMaxKm: semiMajorRefKm * 4,
      eccentricity: 0.04,
      inclinationDeg: 2,
      color,
      sizePx: 1.5,
    },
  };
}

/** A ParticleSystem geometry maps to a particle spec emitting from the body. */
export function particleSpecFromGeometry(
  id: string,
  anchorBody: string,
  g: Geometry,
  bodyRadius: number,
): ParticleSystemSpec | null {
  if (g.type !== 'ParticleSystem') return null;
  return {
    id,
    anchorBody,
    params: {
      count: g.particleCount ?? 600,
      direction: [0, 1, 0],
      spreadDeg: 18,
      lengthKm: bodyRadius * 1.5,
      baseRadiusKm: bodyRadius,
      color: '#cfe8ff',
      sizePx: 2,
    },
  };
}

/** Assemble the final SceneSpec from sampled positions and mapped geometry. */
export function assembleSceneSpec(input: {
  readonly bodies: readonly PlanetDef[];
  readonly spacecraftName: string | null;
  readonly trajectoryPoints: readonly Km3[];
  readonly trajectoryColors?: readonly (readonly [number, number, number])[];
  readonly trajectoryAnchor: string;
  readonly stars?: readonly Star[];
  readonly orbits?: readonly OrbitSpec[];
  readonly rings: readonly RingSpec[];
  readonly atmospheres?: readonly AtmosphereSpec[];
  readonly axisTriads?: readonly AxisTriadSpec[];
  readonly directionVectors?: readonly DirectionVectorsSpec[];
  readonly keplerianSwarms: readonly KeplerianSwarmSpec[];
  readonly particleSystems: readonly ParticleSystemSpec[];
  readonly timeSwitched: readonly TimeSwitchedSpec[];
  readonly cameraFocus: string;
  readonly cameraDistance: number;
}): SceneSpec {
  const labels = [
    ...input.bodies.map((b) => ({ id: b.name, text: b.name, anchorBody: b.name })),
    ...(input.spacecraftName
      ? [{ id: input.spacecraftName, text: input.spacecraftName, anchorBody: input.spacecraftName }]
      : []),
  ];
  return {
    bodies: input.bodies,
    ...(input.spacecraftName ? { spacecraft: { name: input.spacecraftName } } : {}),
    ...(input.trajectoryPoints.length > 0
      ? {
          trajectory: {
            points: input.trajectoryPoints,
            anchorBody: input.trajectoryAnchor,
            ...(input.trajectoryColors ? { colors: input.trajectoryColors } : {}),
          },
        }
      : {}),
    ...(input.stars ? { starField: input.stars } : {}),
    ...(input.orbits && input.orbits.length > 0 ? { orbits: input.orbits } : {}),
    rings: input.rings,
    ...(input.atmospheres && input.atmospheres.length > 0 ? { atmospheres: input.atmospheres } : {}),
    ...(input.axisTriads && input.axisTriads.length > 0 ? { axisTriads: input.axisTriads } : {}),
    ...(input.directionVectors && input.directionVectors.length > 0
      ? { directionVectors: input.directionVectors }
      : {}),
    keplerianSwarms: input.keplerianSwarms,
    particleSystems: input.particleSystems,
    timeSwitched: input.timeSwitched,
    labels,
    camera: { focus: input.cameraFocus, azimuth: 0.6, elevation: 0.35, distance: input.cameraDistance },
  };
}

const scName = (sc: CatalogSpacecraft): string => sc.name ?? sc.id;

/**
 * Orchestrate a generic mission: sample SPICE for every catalog body and the
 * first spacecraft, then assemble a rich SceneSpec (bodies, trajectory, rings,
 * atmospheres, axis triads, direction vectors, swarms, glTF mesh, and the first
 * instrument). With no spacecraft it renders a neutral bodies-only scene over a
 * default window. Throws on a spacecraft with no time window or an unresolved
 * body (loud failure, never a silent re-center).
 */
export async function buildCatalogMissionScene(
  spice: SpiceEngine,
  catalog: BesselCatalog,
  onStatus: (status: string) => void = () => {},
): Promise<MissionScene> {
  const spacecraft = catalog.spacecraft?.[0] ?? null;
  const window = await resolveWindow(spice, spacecraft);
  const [et0, et1] = window;

  // Bodies: catalog-declared, else the inner-system table so the scene is never
  // empty. The Sun is always present as the heliocentric origin and light.
  const catalogDefs = (catalog.bodies ?? []).map(catalogBodyToPlanetDef);
  const bodies = catalogDefs.length > 0 ? withSun(catalogDefs) : INNER_SYSTEM;

  onStatus('Sampling ephemerides');
  const sampleRefs = bodies.map((b) => ({ name: b.name, spiceId: b.spiceId }));
  if (spacecraft) sampleRefs.push({ name: scName(spacecraft), spiceId: spacecraft.id });
  const table = await sampleEphemeris(spice, sampleRefs, et0, et1, STEPS);

  // Spacecraft trajectory sampled in its center frame so the polyline shows the
  // orbit rather than the center body's heliocentric drift.
  let trajectoryPoints: Km3[] = [];
  let trajectoryColors: (readonly [number, number, number])[] | undefined;
  let centerBody = bodies[0]?.name ?? 'Sun';
  if (spacecraft) {
    const center =
      spacecraft.trajectory?.center ?? spacecraft.arcs?.[0]?.trajectory?.center ?? centerBody;
    centerBody = resolveCenterName(center, bodies);
    const orbit = await sampleEphemeris(
      spice,
      [{ name: scName(spacecraft), spiceId: spacecraft.id }],
      et0,
      et1,
      STEPS,
      center,
    );
    trajectoryPoints = trajectoryOf(orbit, scName(spacecraft));
    const ramp = linearRamp('trail', { r: 0.12, g: 0.17, b: 0.38 }, { r: 0.55, g: 0.78, b: 1 });
    trajectoryColors = trajectoryPoints.map((_, i) => {
      const c = ramp.color(i, [0, Math.max(1, trajectoryPoints.length - 1)]);
      return [c.r, c.g, c.b] as const;
    });
  }

  // Map every catalog body's geometry and orientation onto the scene specs.
  const rings: RingSpec[] = [];
  const keplerianSwarms: KeplerianSwarmSpec[] = [];
  const particleSystems: ParticleSystemSpec[] = [];
  const timeSwitched: TimeSwitchedSpec[] = [];
  const axisTriads: AxisTriadSpec[] = [];
  const atmospheres: AtmosphereSpec[] = [];
  for (const body of catalog.bodies ?? []) {
    const name = body.name ?? body.id;
    const radius = bodyRadiusKm(body);
    // A body-fixed orientation frame drives ring orientation and an axis triad.
    const rotation = await bodyRotation(spice, body, et0);
    if (rotation) {
      axisTriads.push({ id: `${name}-axes`, body: name, rotationRowMajor3x3: rotation, lengthKm: radius * 2 });
    }
    const g = body.geometry;
    if (g) {
      const ring = ringSpecFromGeometry(name, g, rotation);
      if (ring) rings.push(ring);
      const swarm = swarmSpecFromGeometry(`${name}-swarm`, name, g, radius, rotation);
      if (swarm) keplerianSwarms.push(swarm);
      const particles = particleSpecFromGeometry(`${name}-particles`, name, g, radius);
      if (particles) particleSystems.push(particles);
      const switched = timeSwitchedFromGeometry(`${name}-switched`, name, g, radius, et0, et1, spice);
      if (switched) timeSwitched.push(await switched);
      const atmo = atmosphereSpecFromBody(name, g, radius, table, et0);
      if (atmo) atmospheres.push(atmo);
    }
  }

  // Orbit paths: each body's osculating ellipse around the Sun, from one state
  // vector (so a full orbit draws without ephemeris over the whole period).
  const orbits = await buildOrbits(spice, bodies, et0);

  // A direction vector toward the Sun (the heliocentric origin) for the spacecraft.
  const directionVectors: DirectionVectorsSpec[] = [];
  if (spacecraft) {
    const scStart = positionAt(table, scName(spacecraft), et0);
    directionVectors.push({
      anchorBody: scName(spacecraft),
      specs: [{ label: 'to-Sun', dirKm: [-scStart[0], -scStart[1], -scStart[2]], color: 0xffd27f }],
      lengthKm: 200000,
    });
  }

  const cameraDistance = FOCUS_DISTANCE[centerBody] ?? DEFAULT_FOCUS_DISTANCE;
  const stars = safeStars();
  const spec = assembleSceneSpec({
    bodies,
    spacecraftName: spacecraft ? scName(spacecraft) : null,
    trajectoryPoints,
    ...(trajectoryColors ? { trajectoryColors } : {}),
    trajectoryAnchor: centerBody,
    ...(stars ? { stars } : {}),
    orbits,
    rings,
    atmospheres,
    axisTriads,
    directionVectors,
    keplerianSwarms,
    particleSystems,
    timeSwitched,
    cameraFocus: centerBody,
    cameraDistance,
  });

  const spacecraftModel = spacecraft ? await loadMeshModel(spacecraft) : null;
  const instrument = resolveInstrument(catalog, spacecraft, centerBody, bodies);
  const attitude = await resolveAttitude(spice, spacecraft, et0);
  return {
    spec,
    table,
    window,
    identity: {
      spacecraftName: spec.spacecraft?.name ?? null,
      ...(spacecraft ? { spacecraftId: spacecraft.id } : {}),
      centerBody,
      ...(attitude ? { attitude } : {}),
    },
    spacecraftModel,
    instrument,
  };
}

/** Resolve a spacecraft orientation into an attitude source the engine applies. */
async function resolveAttitude(
  spice: SpiceEngine,
  spacecraft: CatalogSpacecraft | null,
  et0: number,
): Promise<AttitudeSpec | undefined> {
  const o = spacecraft?.orientation;
  if (!o) return undefined;
  if (o.type === 'Spice' && o.frame) return { kind: 'spice', frame: o.frame };
  if (o.type === 'Fixed' && o.quaternion) return { kind: 'fixed', quaternion: o.quaternion };
  if (o.type === 'UniformRotation' && o.axis && typeof o.ratePerSec === 'number') {
    const epochEt = o.epoch ? await safeEt(spice, o.epoch, et0) : et0;
    return { kind: 'uniform', axis: o.axis, ratePerSec: o.ratePerSec, epochEt };
  }
  return undefined;
}

/** Osculating orbit ellipse (around the Sun) for each body except the Sun. */
async function buildOrbits(
  spice: SpiceEngine,
  bodies: readonly PlanetDef[],
  et0: number,
): Promise<OrbitSpec[]> {
  let mu = GM_SUN;
  try {
    const gm = await spice.bodvrd('SUN', 'GM');
    if (gm && gm.length > 0 && Number.isFinite(gm[0])) mu = gm[0]!;
  } catch {
    // Use the constant fallback.
  }
  const orbits: OrbitSpec[] = [];
  for (const b of bodies) {
    if (b.name.toLowerCase() === 'sun' || b.spiceId === '10') continue;
    try {
      const st = await spice.spkezr(b.spiceId, et0, 'J2000', 'NONE', '10');
      const points = orbitEllipse(
        [st.position.x, st.position.y, st.position.z],
        [st.velocity.x, st.velocity.y, st.velocity.z],
        mu,
      );
      if (points.length > 1) {
        orbits.push({ id: `${b.name}-orbit`, anchorBody: 'Sun', points, color: dimColor(b.color) });
      }
    } catch {
      // No usable state for this body (e.g. outside the loaded ephemeris): skip it.
    }
  }
  return orbits;
}

/** A dim hex color from a body's base RGB, for the faint orbit line. */
function dimColor(color: readonly [number, number, number]): number {
  const r = Math.round(Math.min(1, color[0] * 0.8) * 255);
  const g = Math.round(Math.min(1, color[1] * 0.8) * 255);
  const b = Math.round(Math.min(1, color[2] * 0.9) * 255);
  return (r << 16) | (g << 8) | b;
}

/** Body-fixed rotation (pxform frame -> J2000) when the body declares a Spice frame. */
async function bodyRotation(
  spice: SpiceEngine,
  body: CatalogBody,
  et: number,
): Promise<readonly number[] | undefined> {
  const frame = body.orientation?.type === 'Spice' ? body.orientation.frame : undefined;
  if (!frame) return undefined;
  try {
    return await spice.pxform(frame, 'J2000', et);
  } catch {
    return undefined;
  }
}

/** Atmosphere shell for a Globe that declares one; sun direction is minus the body position. */
function atmosphereSpecFromBody(
  name: string,
  g: Geometry,
  radius: number,
  table: EphemerisTable,
  et0: number,
): AtmosphereSpec | null {
  if (g.type !== 'Globe' || !g.atmosphere) return null;
  const innerKm = g.atmosphere.innerRadius ?? radius;
  const outerKm = g.atmosphere.outerRadius ?? innerKm * 1.05;
  const pos = positionAt(table, name, et0);
  return { body: name, innerKm, outerKm, sunDirection: [-pos[0], -pos[1], -pos[2]], visible: false };
}

/** Load a glTF spacecraft model from a Mesh geometry source URL, or null. */
async function loadMeshModel(spacecraft: CatalogSpacecraft): Promise<Object3D | null> {
  const g = spacecraft.geometry;
  if (!g || g.type !== 'Mesh' || !g.source || typeof fetch !== 'function') return null;
  try {
    const text = await (await fetch(g.source)).text();
    return await loadSpacecraftModel(text, 200);
  } catch (err) {
    console.error('spacecraft model load failed', err);
    return null;
  }
}

/** Resolve the first catalog instrument to the ids the FOV/footprint code needs. */
function resolveInstrument(
  catalog: BesselCatalog,
  spacecraft: CatalogSpacecraft | null,
  centerBody: string,
  bodies: readonly PlanetDef[],
): InstrumentDescriptor | null {
  const inst: CatalogInstrument | undefined = catalog.instruments?.[0];
  if (!inst || !spacecraft) return null;
  const sensorId = Number(inst.sensor);
  const targetId = inst.targets[0];
  if (!Number.isFinite(sensorId) || !targetId) return null;
  // Prefer the center body's declared orientation frame, else the IAU convention.
  const centerCat = (catalog.bodies ?? []).find((b) => (b.name ?? b.id) === centerBody);
  const targetFrame =
    centerCat?.orientation?.type === 'Spice' && centerCat.orientation.frame
      ? centerCat.orientation.frame
      : `IAU_${centerBody.toUpperCase()}`;
  void bodies;
  return { sensorId, observerId: spacecraft.id, targetId, targetFrame, anchorName: centerBody };
}

function timeSwitchedFromGeometry(
  id: string,
  anchorBody: string,
  g: Geometry,
  radius: number,
  et0: number,
  et1: number,
  spice: SpiceEngine,
): Promise<TimeSwitchedSpec> | null {
  if (g.type !== 'TimeSwitched') return null;
  return (async (): Promise<TimeSwitchedSpec> => {
    const segments = await Promise.all(
      g.segments.map(async (seg, i) => {
        const start = await safeEt(spice, seg.timeRange.start, et0);
        const stop = await safeEt(spice, seg.timeRange.stop, et1);
        const color = i % 2 === 0 ? '#7cfc00' : '#33ccff';
        return { start, end: stop, color, radiusKm: radius * 0.4 };
      }),
    );
    return { id, anchorBody, offsetKm: radius * 3, segments };
  })();
}

async function resolveWindow(
  spice: SpiceEngine,
  spacecraft: CatalogSpacecraft | null,
): Promise<readonly [number, number]> {
  // No spacecraft: a neutral bodies-only scene over the default window.
  if (!spacecraft) {
    const e0 = await spice.str2et(toSpiceUtc(DEFAULT_WINDOW[0]));
    const e1 = await spice.str2et(toSpiceUtc(DEFAULT_WINDOW[1]));
    return missionWindow(e0, e1, 1800);
  }
  // A spacecraft present without a time window cannot be sampled: fail loudly.
  const range = spacecraft.arcs?.[0]?.timeRange;
  if (!range) {
    throw new Error(
      'Mission has no time window: the first spacecraft needs an arc with a timeRange to bound sampling',
    );
  }
  const rawEt0 = await spice.str2et(toSpiceUtc(range.start));
  const rawEt1 = await spice.str2et(toSpiceUtc(range.stop));
  return missionWindow(rawEt0, rawEt1, 1800);
}

async function safeEt(spice: SpiceEngine, utc: string, fallback: number): Promise<number> {
  try {
    return await spice.str2et(toSpiceUtc(utc));
  } catch {
    return fallback;
  }
}

// CSPICE str2et reads a UTC calendar string but does not accept the ISO 8601 "Z"
// zone suffix, so strip it. The time is already UTC by SPICE convention.
function toSpiceUtc(utc: string): string {
  return utc.endsWith('Z') ? utc.slice(0, -1) : utc;
}

function resolveCenterName(center: string, bodies: readonly PlanetDef[]): string {
  const match = bodies.find(
    (b) => b.name.toLowerCase() === center.toLowerCase() || b.spiceId === center,
  );
  return match?.name ?? center;
}

function withSun(defs: readonly PlanetDef[]): readonly PlanetDef[] {
  if (defs.some((d) => d.name.toLowerCase() === 'sun' || d.spiceId === '10')) return defs;
  return [INNER_SYSTEM[0]!, ...defs];
}

function safeStars(): readonly Star[] | undefined {
  try {
    return parseStarCatalog(brightStars);
  } catch (err) {
    console.error('star catalog parse failed', err);
    return undefined;
  }
}
