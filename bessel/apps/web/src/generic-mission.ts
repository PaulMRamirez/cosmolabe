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
  SOLAR_SYSTEM,
  loadSpacecraftModel,
  orbitEllipse,
  orbitPeriod,
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
  type LabelSpec,
} from '@bessel/scene';
import { linearRamp, oklchToRgb, rgbToHexNumber, rgbToHexString } from '@bessel/color';
import { tokenValues } from '@bessel/selene-design/tokens';
import type {
  BesselCatalog,
  CatalogBody,
  CatalogSpacecraft,
  CssColor,
  Geometry,
  Label,
  TrajectoryPlot,
} from '@bessel/catalog';
import type { SpiceEngine } from '@bessel/spice';
import type { FileSystem } from '@bessel/pal';
import type { Object3D } from 'three';
import brightStars from './assets/bright-stars.json';
import { buildBodyFrameMap, resolveBodyFrame } from './readouts.ts';
import { sampleEphemeris, positionAt, trajectoryOf, type EphemerisTable } from './sampler.ts';
import { planTwoVector, type TwoVectorSpec } from './trajectory/twovector.ts';
import {
  cssColorToRgb01,
  plotColors,
  plotWindow,
  type Rgb01,
} from './trajectory/trajectory-plot.ts';
import { missionWindow } from './mission/duration.ts';
import { STEPS, FOCUS_DISTANCE, DEFAULT_FOCUS_DISTANCE } from './engine/constants.ts';

/** Default sampling window (UTC) for a neutral mission with no spacecraft arc. */
const DEFAULT_WINDOW: readonly [string, string] = ['2004-06-22T00:00:00', '2004-08-22T00:00:00'];

/** Gravitational parameters (km^3/s^2), the fallback when PCK GM is unavailable. */
const GM_SUN = 1.32712440018e11;
const GM_EARTH = 398600.435436;

/** How the spacecraft model is oriented each frame, from the catalog. */
export type AttitudeSpec =
  | { readonly kind: 'spice'; readonly frame: string }
  | { readonly kind: 'fixed'; readonly quaternion: readonly [number, number, number, number] }
  | {
      readonly kind: 'uniform';
      readonly axis: readonly [number, number, number];
      readonly ratePerSec: number;
      readonly epochEt: number;
    }
  | { readonly kind: 'twovector'; readonly spec: TwoVectorSpec };

/** A catalog per-item label resolved to the scene's needs (C17). */
export interface ResolvedLabel {
  /** false hides the label entirely; true/undefined shows it. */
  readonly show?: boolean;
  /** Override text; absent => the derived name. */
  readonly text?: string;
  /** CSS color for the label text. */
  readonly color?: string;
}

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
  /** The catalog instrument id, shown in the instrument selector. */
  readonly name: string;
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
  /** The active (first) catalog instrument, resolved, or null if the mission has none. */
  readonly instrument?: InstrumentDescriptor | null;
  /** Every resolved catalog instrument, for the instrument selector. */
  readonly instruments: readonly InstrumentDescriptor[];
  /** Body-name/id -> declared body-fixed frame, for illumination readouts and the
   *  instrument target frame. Empty when no body declares a Spice orientation. */
  readonly bodyFrames: ReadonlyMap<string, string>;
}

const INNER_BY_NAME = new Map(SOLAR_SYSTEM.map((p) => [p.name.toLowerCase(), p]));

const DEFAULT_BODY_COLOR: readonly [number, number, number] = [0.6, 0.62, 0.66];

// Scene accent colors derived from the @bessel/selene-design tokens so the 3D
// overlays track the UI palette. oklch is not parseable by THREE.Color, so the
// token's oklch source is converted to sRGB once here (amber as a hex number for
// the direction vector, green/cyan as hex strings for the time-switched segments).
const ACCENT_AMBER = rgbToHexNumber(oklchToRgb(tokenValues.amber));
const SEGMENT_NOMINAL = rgbToHexString(oklchToRgb(tokenValues.green));
const SEGMENT_DATA = rgbToHexString(oklchToRgb(tokenValues.cyan));
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
  const globe = g && g.type === 'Globe' ? g : undefined;
  const specularColor = cssColorToRgb(globe?.specularColor);
  return {
    name,
    spiceId: body.id,
    radiusKm: bodyRadiusKm(body),
    color: known?.color ?? DEFAULT_BODY_COLOR,
    ...(globe?.texture ? { texture: globe.texture } : {}),
    ...(globe?.normalMap ? { normalMap: globe.normalMap } : {}),
    ...(globe?.nightTexture ? { nightTexture: globe.nightTexture } : {}),
    ...(globe?.cloudMap ? { cloudMap: globe.cloudMap } : {}),
    ...(globe?.cloudAltitudeKm !== undefined ? { cloudAltitudeKm: globe.cloudAltitudeKm } : {}),
    ...(specularColor ? { specularColor } : {}),
    ...(globe?.specularPower !== undefined ? { specularPower: globe.specularPower } : {}),
  };
}

/** Convert a catalog CssColor to a CSS color string (hex passthrough, object => rgb()). */
function cssColorToCss(c: CssColor | undefined): string | undefined {
  if (c === undefined) return undefined;
  if (typeof c === 'string') return c;
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return c.a === undefined
    ? `rgb(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)})`
    : `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${Math.max(0, Math.min(1, c.a))})`;
}

/**
 * Build the per-item label override map (C17) keyed by the anchor name the scene
 * labels by (a body/spacecraft name, else its id). Each catalog `label` contributes
 * its text/color and its show flag; items without a label are absent (derived label).
 */
export function buildLabelOverrides(catalog: BesselCatalog): Map<string, ResolvedLabel> {
  const map = new Map<string, ResolvedLabel>();
  const add = (name: string, label: Label | undefined): void => {
    if (!label) return;
    map.set(name, {
      ...(label.show !== undefined ? { show: label.show } : {}),
      ...(label.text !== undefined ? { text: label.text } : {}),
      ...(cssColorToCss(label.color) !== undefined ? { color: cssColorToCss(label.color)! } : {}),
    });
  };
  for (const b of catalog.bodies ?? []) add(b.name ?? b.id, b.label);
  for (const sc of catalog.spacecraft ?? []) add(scName(sc), sc.label);
  return map;
}

/** Convert a catalog CssColor (string or {r,g,b}) to a 0..1 RGB tuple, or undefined. */
function cssColorToRgb(c: CssColor | undefined): readonly [number, number, number] | undefined {
  if (c === undefined) return undefined;
  if (typeof c === 'object') return [c.r, c.g, c.b];
  const hex = c.trim().replace(/^#/, '');
  if (hex.length !== 6) return undefined;
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return undefined;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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
  /** Per-item label overrides keyed by anchor name (C17); absent name => derived label. */
  readonly labelOverrides?: ReadonlyMap<string, ResolvedLabel>;
}): SceneSpec {
  const overrides = input.labelOverrides;
  const labelFor = (name: string): LabelSpec | null => {
    const o = overrides?.get(name);
    // show:false (C17) omits the label entirely; otherwise the override's text/color
    // takes precedence, falling back to the derived name.
    if (o && o.show === false) return null;
    return {
      id: name,
      text: o?.text ?? name,
      anchorBody: name,
      ...(o?.color ? { color: o.color } : {}),
    };
  };
  const labels = [
    ...input.bodies.map((b) => labelFor(b.name)),
    ...(input.spacecraftName ? [labelFor(input.spacecraftName)] : []),
  ].filter((l): l is LabelSpec => l !== null);
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
 * Per-vertex trajectory colors (C16): a declared trajectoryPlot.color (with its
 * optional fade) overrides the synthesized trail ramp; otherwise the existing blue
 * trail ramp is the fallback. Returns undefined for an empty polyline.
 */
function trajectoryColorsFor(plot: TrajectoryPlot | undefined, count: number): Rgb01[] | undefined {
  if (count === 0) return undefined;
  const declared = cssColorToRgb01(plot?.color);
  if (declared) return plotColors(declared, plot?.fade, count);
  const ramp = linearRamp('trail', { r: 0.12, g: 0.17, b: 0.38 }, { r: 0.55, g: 0.78, b: 1 });
  return Array.from({ length: count }, (_, i) => {
    const c = ramp.color(i, [0, Math.max(1, count - 1)]);
    return [c.r, c.g, c.b] as Rgb01;
  });
}

/**
 * Add a heliocentric (Sun-relative) entry for a non-SPICE spacecraft to the table.
 * The resolver produces positions relative to the center body, so the heliocentric
 * track is the center body's Sun-relative position (already in the table) plus the
 * center-relative sample at each step. With the Sun as the center the relative and
 * heliocentric frames coincide, so the offset is zero. This lets playback, readouts,
 * and the direction vector treat the propagated craft exactly like a SPICE body.
 */
function injectHeliocentricCraft(
  table: EphemerisTable,
  craftName: string,
  centerName: string,
  relativeFlat: Float64Array,
): void {
  const steps = table.steps;
  const centerFlat = centerName.toLowerCase() === 'sun' ? undefined : table.byBody.get(centerName);
  const flat = new Float64Array(steps * 3);
  for (let k = 0; k < steps * 3; k++) {
    flat[k] = relativeFlat[k]! + (centerFlat ? centerFlat[k]! : 0);
  }
  (table.byBody as Map<string, Float64Array>).set(craftName, flat);
}

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
  fs?: FileSystem,
): Promise<MissionScene> {
  const spacecraft = catalog.spacecraft?.[0] ?? null;
  const window = await resolveWindow(spice, spacecraft);
  const [et0, et1] = window;

  // Bodies: catalog-declared, else the inner-system table so the scene is never
  // empty. The Sun is always present as the heliocentric origin and light.
  const catalogDefs = (catalog.bodies ?? []).map(catalogBodyToPlanetDef);
  const bodies = catalogDefs.length > 0 ? withSun(catalogDefs) : SOLAR_SYSTEM;

  // The active trajectory: the spacecraft's own, else its first arc's. A non-SPICE
  // source cannot be sampled by spkpos (its id is not in any kernel), so it is held
  // out of the heliocentric table here and injected from the resolver output below.
  const trajectory = spacecraft
    ? spacecraft.trajectory ?? spacecraft.arcs?.[0]?.trajectory
    : undefined;
  const spacecraftIsSpice = !trajectory || trajectory.type === 'Spice';

  onStatus('Sampling ephemerides');
  const sampleRefs = bodies.map((b) => ({ name: b.name, spiceId: b.spiceId }));
  if (spacecraft && spacecraftIsSpice) {
    sampleRefs.push({ name: scName(spacecraft), spiceId: spacecraft.id });
  }
  const table = await sampleEphemeris(spice, sampleRefs, et0, et1, STEPS);

  // Spacecraft trajectory sampled in its center frame so the polyline shows the
  // orbit rather than the center body's heliocentric drift. A declared
  // trajectoryPlot (C16) bounds the drawn arc (lead/trail/duration around the
  // load-time cursor epoch et0), sets the sample density (sampleCount), and colors
  // the polyline (color/fade); without one we keep the synthesized blue ramp.
  let trajectoryPoints: Km3[] = [];
  let trajectoryColors: Rgb01[] | undefined;
  let centerBody = bodies[0]?.name ?? 'Sun';
  if (spacecraft) {
    const center = trajectory?.center ?? centerBody;
    centerBody = resolveCenterName(center, bodies);
    const plot = spacecraft.trajectoryPlot;
    const pw = plotWindow(plot, et0, et0, et1, STEPS);
    if (trajectory && trajectory.type !== 'Spice') {
      // Dynamic import keeps @bessel/propagator (SGP4, mean elements) out of the
      // first-paint shell; the resolver and its samplers land in the lazy bundle.
      const { sampleTrajectory, trajectoryGrid, tablePoints } = await import('./trajectory/index.ts');
      const grid = trajectoryGrid(pw.et0, pw.et1, pw.steps);
      const sampled = await sampleTrajectory(
        spice,
        fs,
        trajectory,
        grid,
        scName(spacecraft),
        spacecraft.id,
      );
      // Center-relative points render the orbit polyline; the heliocentric table
      // entry (center body position + the relative sample) lets playback and the
      // readouts track the craft like any SPICE body. The full-window grid keeps the
      // heliocentric table covering the whole mission for playback/readouts even when
      // the drawn arc is bounded; so inject from a separate full-window sample.
      trajectoryPoints = tablePoints(sampled);
      const fullGrid = trajectoryGrid(et0, et1, STEPS);
      const full = await sampleTrajectory(spice, fs, trajectory, fullGrid, scName(spacecraft), spacecraft.id);
      injectHeliocentricCraft(table, scName(spacecraft), centerBody, full.flat);
    } else {
      const orbit = await sampleEphemeris(
        spice,
        [{ name: scName(spacecraft), spiceId: spacecraft.id }],
        pw.et0,
        pw.et1,
        pw.steps,
        center,
      );
      trajectoryPoints = trajectoryOf(orbit, scName(spacecraft));
    }
    trajectoryColors = trajectoryColorsFor(plot, trajectoryPoints.length);
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
      specs: [{ label: 'to-Sun', dirKm: [-scStart[0], -scStart[1], -scStart[2]], color: ACCENT_AMBER }],
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
    labelOverrides: buildLabelOverrides(catalog),
  });

  const spacecraftModel = spacecraft ? await loadMeshModel(spacecraft) : null;
  // One source of truth for body-fixed frames: illumination readouts and the
  // instrument target frame both resolve through this map.
  const bodyFrames = buildBodyFrameMap(catalog);
  const instruments = resolveInstruments(catalog, spacecraft, centerBody, bodyFrames);
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
    instrument: instruments[0] ?? null,
    instruments,
    bodyFrames,
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
  // TwoVector (C18): plan the two reference directions now (fail loud on a malformed
  // declaration) so the engine can resolve a per-frame attitude as the directions move.
  if (o.type === 'TwoVector' && spacecraft) {
    return { kind: 'twovector', spec: planTwoVector(o, spacecraft.id) };
  }
  return undefined;
}

/** Points traced along a body's orbit path (true sampling or osculating fallback). */
const ORBIT_SAMPLES = 256;

/**
 * Orbit path for each body: around the Sun, except the Moon, which orbits Earth.
 * The path is the body's true ephemeris over one osculating period, sampled from
 * SPICE, so real perturbations show (notably the Moon's solar-driven wobble).
 * When the loaded ephemeris does not span a full period (e.g. the bundled
 * inner-system + Cassini kernel for an outer planet), fall back to the
 * osculating ellipse, which needs only the start-epoch state vector.
 */
async function buildOrbits(
  spice: SpiceEngine,
  bodies: readonly PlanetDef[],
  et0: number,
): Promise<OrbitSpec[]> {
  const muSun = await gmOf(spice, 'SUN', GM_SUN);
  const muEarth = await gmOf(spice, 'EARTH', GM_EARTH);
  const hasEarth = bodies.some((x) => x.name === 'Earth');
  const orbits: OrbitSpec[] = [];
  for (const b of bodies) {
    if (b.name.toLowerCase() === 'sun' || b.spiceId === '10') continue;
    // The Moon orbits Earth; every other body orbits the Sun.
    const moon = b.spiceId === '301';
    if (moon && !hasEarth) continue;
    const centerId = moon ? '399' : '10';
    const anchorBody = moon ? 'Earth' : 'Sun';
    const mu = moon ? muEarth : muSun;
    let state;
    try {
      state = await spice.spkezr(b.spiceId, et0, 'J2000', 'NONE', centerId);
    } catch {
      // No usable state at the start epoch (e.g. outside the loaded ephemeris).
      continue;
    }
    const pos: Km3 = [state.position.x, state.position.y, state.position.z];
    const vel: Km3 = [state.velocity.x, state.velocity.y, state.velocity.z];
    const period = orbitPeriod(pos, vel, mu);
    // True path when the ephemeris spans a period; else the osculating ellipse.
    let points: Km3[] = [];
    if (period !== null) {
      points = await sampleTruePath(spice, b.spiceId, centerId, et0, period).catch(() => []);
    }
    if (points.length < 2) points = orbitEllipse(pos, vel, mu);
    if (points.length > 1) {
      orbits.push({ id: `${b.name}-orbit`, anchorBody, points, color: dimColor(b.color) });
    }
  }
  return orbits;
}

/**
 * Trace a body's true path relative to centerId over one period, as a closed
 * polyline (km, J2000). Rejects if any sample falls outside the loaded
 * ephemeris, so the caller can fall back to the osculating ellipse.
 */
async function sampleTruePath(
  spice: SpiceEngine,
  spiceId: string,
  centerId: string,
  et0: number,
  period: number,
): Promise<Km3[]> {
  const results = await Promise.all(
    Array.from({ length: ORBIT_SAMPLES }, (_, i) =>
      spice.spkpos(spiceId, et0 + (i / ORBIT_SAMPLES) * period, 'J2000', 'NONE', centerId),
    ),
  );
  const points: Km3[] = results.map((r) => [r.position.x, r.position.y, r.position.z]);
  if (points.length > 0) points.push(points[0]!); // close the ring
  return points;
}

/** A body's GM (km^3/s^2) from the PCK, or a fallback when bodvrd has no GM. */
async function gmOf(spice: SpiceEngine, body: string, fallback: number): Promise<number> {
  try {
    const gm = await spice.bodvrd(body, 'GM');
    if (gm && gm.length > 0 && Number.isFinite(gm[0])) return gm[0]!;
  } catch {
    // Use the constant fallback.
  }
  return fallback;
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

/** Resolve every catalog instrument to the ids the FOV/footprint code needs. The
 *  first valid one is the active instrument; the rest populate the selector. */
function resolveInstruments(
  catalog: BesselCatalog,
  spacecraft: CatalogSpacecraft | null,
  centerBody: string,
  bodyFrames: ReadonlyMap<string, string>,
): InstrumentDescriptor[] {
  if (!spacecraft) return [];
  // Same source of truth as the illumination readouts: the declared body-fixed
  // frame, else the IAU convention (never null here since centerBody is never the Sun).
  const targetFrame = resolveBodyFrame(centerBody, bodyFrames) ?? `IAU_${centerBody.toUpperCase()}`;
  const out: InstrumentDescriptor[] = [];
  const seen = new Set<string>();
  for (const inst of catalog.instruments ?? []) {
    // Instrument ids name the selector entry and resolve the active sensor, so they
    // must be unique; a duplicate would make one sensor permanently unreachable.
    // Fail loud (per the bad-catalog-reference convention) rather than silently drop it.
    if (seen.has(inst.id)) {
      throw new Error(`Catalog instrument id "${inst.id}" is declared more than once; ids must be unique`);
    }
    seen.add(inst.id);
    const sensorId = Number(inst.sensor);
    const targetId = inst.targets[0];
    if (!Number.isFinite(sensorId) || !targetId) continue;
    out.push({
      name: inst.id,
      sensorId,
      observerId: spacecraft.id,
      targetId,
      targetFrame,
      anchorName: centerBody,
    });
  }
  return out;
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
        const color = i % 2 === 0 ? SEGMENT_NOMINAL : SEGMENT_DATA;
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
  return [SOLAR_SYSTEM[0]!, ...defs];
}

function safeStars(): readonly Star[] | undefined {
  try {
    return parseStarCatalog(brightStars);
  } catch (err) {
    console.error('star catalog parse failed', err);
    return undefined;
  }
}
