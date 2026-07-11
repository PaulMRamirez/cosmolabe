// Cosmographia catalog compatibility (ADR-0006). Phase 0 supports the SPICE
// trajectory subset needed to render a spacecraft path; Phase 1 widens this to
// the full geometry taxonomy. Bad references fail loudly with a located error.

import { CatalogError, type SpacecraftCatalog } from './index.ts';
import { parseBesselCatalog } from './validator.ts';
import type {
  BesselCatalog,
  CatalogBody,
  CatalogInstrument,
  CatalogObservation,
  CatalogSpacecraft,
  CssColor,
  Geometry,
  KeplerianElements,
  Label,
  Mass,
  Orientation,
  ReferenceDirection,
  TimeRange,
  Trajectory,
  TrajectoryPlot,
} from './native-types.ts';

export interface CosmographiaSpiceTrajectory {
  readonly type: 'Spice';
  readonly target: string;
  readonly center: string;
  readonly frame?: string;
}

export interface CosmographiaItem {
  readonly class?: string;
  readonly name: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly trajectory: CosmographiaSpiceTrajectory;
}

export interface CosmographiaCatalog {
  readonly version?: string;
  readonly name: string;
  readonly spiceKernels?: readonly string[];
  readonly items: readonly CosmographiaItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CatalogError(`Expected a non-empty string at ${location}`, location);
  }
  return value;
}

/**
 * Parse a Cosmographia catalog and return the first spacecraft as a typed
 * SpacecraftCatalog. Throws a located CatalogError on any bad reference rather
 * than silently re-centering (the loud-failure principle, CLAUDE.md).
 */
export function parseCosmographiaCatalog(raw: unknown): SpacecraftCatalog {
  if (!isRecord(raw)) throw new CatalogError('Catalog root must be an object', '$');
  // Validate the catalog name is present (fail loud) even though the spacecraft
  // item name is what we return.
  requireString(raw['name'], '$.name');

  const items = raw['items'];
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogError('Catalog must have a non-empty items array', '$.items');
  }

  const index = items.findIndex(
    (item) => isRecord(item) && (item['class'] === 'spacecraft' || 'trajectory' in item),
  );
  if (index < 0) {
    throw new CatalogError('No spacecraft item found in catalog', '$.items');
  }
  const item = items[index] as Record<string, unknown>;
  const loc = `$.items[${index}]`;

  const trajectory = item['trajectory'];
  if (!isRecord(trajectory)) {
    throw new CatalogError('Spacecraft item is missing a trajectory', `${loc}.trajectory`);
  }
  if (trajectory['type'] !== 'Spice') {
    throw new CatalogError(
      `Unsupported trajectory type "${String(trajectory['type'])}" (Phase 0 supports "Spice")`,
      `${loc}.trajectory.type`,
    );
  }

  const spiceId = requireString(trajectory['target'], `${loc}.trajectory.target`);
  const center = requireString(trajectory['center'], `${loc}.trajectory.center`);
  const frame = typeof trajectory['frame'] === 'string' ? trajectory['frame'] : 'J2000';

  const kernelsRaw = raw['spiceKernels'];
  const kernels =
    kernelsRaw === undefined
      ? []
      : Array.isArray(kernelsRaw)
        ? kernelsRaw.map((k, i) => requireString(k, `$.spiceKernels[${i}]`))
        : (() => {
            throw new CatalogError('spiceKernels must be an array', '$.spiceKernels');
          })();

  return {
    name: requireString(item['name'], `${loc}.name`),
    spiceId,
    frame,
    center,
    kernels,
    ...(typeof item['startTime'] === 'string' ? { startTime: item['startTime'] } : {}),
    ...(typeof item['endTime'] === 'string' ? { endTime: item['endTime'] } : {}),
  };
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asColor = (v: unknown): CssColor | undefined => {
  if (typeof v === 'string') return v;
  if (isRecord(v) && typeof v['r'] === 'number' && typeof v['g'] === 'number' && typeof v['b'] === 'number') {
    return { r: v['r'], g: v['g'], b: v['b'], ...(typeof v['a'] === 'number' ? { a: v['a'] } : {}) };
  }
  return undefined;
};
const asRadii = (v: unknown): readonly [number, number, number] | undefined => {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) {
    return [v[0] as number, v[1] as number, v[2] as number];
  }
  return undefined;
};

/**
 * Map a Cosmographia geometry record (Globe or RingSystem) onto the native
 * Geometry. Globe accepts Cosmographia's `baseMap` as the diffuse alias and
 * carries `cloudMap`/`specularColor`/`specularPower`/`emissive`; RingSystem maps
 * `innerRadius`/`outerRadius`/`texture`. Returns null for unsupported types so
 * the caller can decide whether the omission is fatal (loud at the call site).
 */
export function cosmographiaGeometryToNative(raw: unknown): Geometry | null {
  if (!isRecord(raw)) throw new CatalogError('Geometry must be an object', '$.geometry');
  const type = raw['type'];
  if (type === 'Globe') {
    const radii = asRadii(raw['radii']);
    // Cosmographia's diffuse field is `baseMap`; native names it `texture`.
    const texture = asString(raw['baseMap']) ?? asString(raw['texture']);
    const cloudAltitudeKm = asNumber(raw['cloudAltitude']) ?? asNumber(raw['cloudAltitudeKm']);
    const specularColor = asColor(raw['specularColor']);
    const specularPower = asNumber(raw['specularPower']);
    // A Globe may carry a nested ring system; map it through the Rings branch so it
    // round-trips rather than being dropped.
    const ringsRaw = raw['rings'];
    const rings = isRecord(ringsRaw) ? cosmographiaGeometryToNative({ type: 'Rings', ...ringsRaw }) : null;
    return {
      type: 'Globe',
      ...(radii ? { radii } : {}),
      ...(texture !== undefined ? { texture } : {}),
      ...(asString(raw['nightTexture']) !== undefined ? { nightTexture: raw['nightTexture'] as string } : {}),
      ...(asString(raw['normalMap']) !== undefined ? { normalMap: raw['normalMap'] as string } : {}),
      ...(asString(raw['cloudMap']) !== undefined ? { cloudMap: raw['cloudMap'] as string } : {}),
      ...(cloudAltitudeKm !== undefined ? { cloudAltitudeKm } : {}),
      ...(specularColor !== undefined ? { specularColor } : {}),
      ...(specularPower !== undefined ? { specularPower } : {}),
      ...(typeof raw['emissive'] === 'boolean' ? { emissive: raw['emissive'] } : {}),
      ...(rings !== null && rings.type === 'Rings' ? { rings } : {}),
    };
  }
  if (type === 'RingSystem' || type === 'Rings') {
    const inner = asNumber(raw['innerRadius']);
    const outer = asNumber(raw['outerRadius']);
    const texture = asString(raw['texture']);
    if (inner === undefined || outer === undefined) {
      throw new CatalogError('Ring system requires innerRadius and outerRadius', '$.geometry');
    }
    return {
      type: 'Rings',
      innerRadius: inner,
      outerRadius: outer,
      ...(texture !== undefined ? { texture } : {}),
    };
  }
  if (type === 'Mesh') {
    // Cosmographia carries the model file under `source`/`meshSource`/`meshUrl`.
    const source = asString(raw['source']) ?? asString(raw['meshSource']) ?? asString(raw['meshUrl']);
    const scale = asNumber(raw['scale']) ?? asNumber(raw['meshScale']);
    return {
      type: 'Mesh',
      ...(source !== undefined ? { source } : {}),
      ...(scale !== undefined ? { scale } : {}),
    };
  }
  if (type === 'DSK') {
    const source = asString(raw['source']) ?? asString(raw['dskSource']);
    const scale = asNumber(raw['scale']);
    return {
      type: 'DSK',
      ...(source !== undefined ? { source } : {}),
      ...(scale !== undefined ? { scale } : {}),
    };
  }
  if (type === 'ParticleSystem') {
    const source = asString(raw['source']);
    const particleCount = asNumber(raw['particleCount']) ?? asNumber(raw['count']);
    return {
      type: 'ParticleSystem',
      ...(source !== undefined ? { source } : {}),
      ...(particleCount !== undefined ? { particleCount } : {}),
    };
  }
  if (type === 'KeplerianSwarm') {
    const source = asString(raw['source']);
    const color = asColor(raw['color']);
    return {
      type: 'KeplerianSwarm',
      ...(source !== undefined ? { source } : {}),
      ...(color !== undefined ? { color } : {}),
    };
  }
  if (type === 'TimeSwitched') {
    const rawSegments = raw['segments'];
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      throw new CatalogError('TimeSwitched geometry requires a non-empty segments array', '$.geometry.segments');
    }
    const segments = rawSegments.map((seg, i) => {
      if (!isRecord(seg)) {
        throw new CatalogError('TimeSwitched segment must be an object', `$.geometry.segments[${i}]`);
      }
      const timeRange = asTimeRange(seg['timeRange'], `$.geometry.segments[${i}].timeRange`);
      const geometry = cosmographiaGeometryToNative(seg['geometry']);
      if (geometry === null) {
        throw new CatalogError(
          'TimeSwitched segment has an unsupported geometry',
          `$.geometry.segments[${i}].geometry`,
        );
      }
      return { timeRange, geometry };
    });
    return { type: 'TimeSwitched', segments };
  }
  return null;
}

/** Coerce a Cosmographia time range ({ start, stop } or { start, end }) to native. */
function asTimeRange(raw: unknown, location: string): TimeRange {
  if (!isRecord(raw)) throw new CatalogError('Expected a time range object', location);
  const start = asString(raw['start']) ?? asString(raw['beginning']);
  const stop = asString(raw['stop']) ?? asString(raw['end']) ?? asString(raw['ending']);
  if (start === undefined || stop === undefined) {
    throw new CatalogError('Time range requires start and stop', location);
  }
  return { start, stop };
}

const asInt = (v: unknown): number | undefined => {
  const n = asNumber(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};

const asVec3 = (v: unknown): readonly [number, number, number] | undefined => asRadii(v);

const asDuration = (v: unknown): string | number | undefined => {
  if (typeof v === 'string' && v.length > 0) return v;
  return asNumber(v);
};

/**
 * Map a Cosmographia trajectory record onto the native Trajectory union, covering
 * all five forms. Fails loudly (located CatalogError) on an unknown type or a
 * missing required parameter, never silently dropping a body.
 */
export function cosmographiaTrajectoryToNative(raw: unknown, location = '$.trajectory'): Trajectory {
  if (!isRecord(raw)) throw new CatalogError('Trajectory must be an object', location);
  const type = raw['type'];
  const center = asString(raw['center']);
  const frame = asString(raw['frame']);
  const shared = {
    ...(center !== undefined ? { center } : {}),
    ...(frame !== undefined ? { frame } : {}),
  };

  if (type === 'Spice') {
    const target = asString(raw['target']) ?? asString(raw['body']);
    return { type: 'Spice', ...(target !== undefined ? { target } : {}), ...shared };
  }

  if (type === 'InterpolatedStates' || type === 'Sampled') {
    const source = asString(raw['source']) ?? asString(raw['states']) ?? asString(raw['stateTable']);
    if (source === undefined) {
      throw new CatalogError('Sampled trajectory requires a source', `${location}.source`);
    }
    const format = raw['format'];
    return {
      type: 'Sampled',
      source,
      ...(format === 'xyz' || format === 'oem' ? { format } : {}),
      ...shared,
    };
  }

  if (type === 'Keplerian' || type === 'TwoBody') {
    const elements = cosmographiaKeplerianElements(raw, location);
    const mu = asNumber(raw['mu']) ?? asNumber(raw['gm']);
    return { type: 'Keplerian', elements, ...(mu !== undefined ? { mu } : {}), ...shared };
  }

  if (type === 'TLE' || type === 'Tle') {
    const line1 = asString(raw['line1']) ?? asString(raw['tleLine1']);
    const line2 = asString(raw['line2']) ?? asString(raw['tleLine2']);
    if (line1 === undefined || line2 === undefined) {
      throw new CatalogError('TLE trajectory requires line1 and line2', `${location}.line1`);
    }
    return { type: 'Tle', line1, line2, ...shared };
  }

  if (type === 'FixedPoint' || type === 'Fixed') {
    const position = asVec3(raw['position']);
    if (position === undefined) {
      throw new CatalogError('Fixed trajectory requires a position [x, y, z]', `${location}.position`);
    }
    return { type: 'Fixed', position, ...shared };
  }

  throw new CatalogError(`Unsupported trajectory type "${String(type)}"`, `${location}.type`);
}

/** Map Cosmographia Keplerian/TwoBody elements onto the native classical-element block. */
function cosmographiaKeplerianElements(
  raw: Record<string, unknown>,
  location: string,
): KeplerianElements {
  // Cosmographia names: semiMajorAxis, eccentricity, inclination, ascendingNode,
  // argumentOfPeriapsis, meanAnomaly, epoch. Accept the native short names too.
  const elements = isRecord(raw['elements']) ? raw['elements'] : raw;
  const a = asNumber(elements['a']) ?? asNumber(elements['semiMajorAxis']) ?? asNumber(elements['sma']);
  const e = asNumber(elements['e']) ?? asNumber(elements['eccentricity']) ?? asNumber(elements['ecc']);
  const i = asNumber(elements['i']) ?? asNumber(elements['inclination']) ?? asNumber(elements['inc']);
  const raan =
    asNumber(elements['raan']) ?? asNumber(elements['ascendingNode']) ?? asNumber(elements['longitudeOfAscendingNode']);
  const argp =
    asNumber(elements['argp']) ?? asNumber(elements['argumentOfPeriapsis']) ?? asNumber(elements['periapsisArgument']);
  const m0 = asNumber(elements['m0']) ?? asNumber(elements['meanAnomaly']) ?? asNumber(elements['meanAnomalyAtEpoch']);
  const epoch = asString(elements['epoch']);
  if (
    a === undefined ||
    e === undefined ||
    i === undefined ||
    raan === undefined ||
    argp === undefined ||
    m0 === undefined ||
    epoch === undefined
  ) {
    throw new CatalogError(
      'Keplerian trajectory requires a, e, i, raan, argp, m0, and epoch',
      `${location}.elements`,
    );
  }
  return { a, e, i, raan, argp, m0, epoch };
}

/** Map one Cosmographia reference direction (axis or target) onto the native shape. */
function cosmographiaReferenceDirection(raw: unknown, location: string): ReferenceDirection {
  if (!isRecord(raw)) throw new CatalogError('Reference direction must be an object', location);
  const axisRaw = raw['axis'];
  let axis: ReferenceDirection['axis'];
  if (typeof axisRaw === 'string' && ['x', 'y', 'z', '-x', '-y', '-z'].includes(axisRaw)) {
    axis = axisRaw as ReferenceDirection['axis'];
  } else {
    const v = asVec3(axisRaw);
    if (v !== undefined) axis = v;
  }
  const target = asString(raw['target']);
  const frame = asString(raw['frame']);
  return {
    ...(axis !== undefined ? { axis } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(frame !== undefined ? { frame } : {}),
  };
}

/**
 * Map a Cosmographia rotationModel onto the native Orientation, covering Spice,
 * Fixed (quaternion), UniformRotation (axis/rate/epoch), and TwoVector
 * (primary/secondary). Fails loudly on an unknown type.
 */
export function cosmographiaRotationToNative(raw: unknown, location = '$.rotationModel'): Orientation {
  if (!isRecord(raw)) throw new CatalogError('rotationModel must be an object', location);
  const type = raw['type'];
  const frame = asString(raw['frame']);

  if (type === 'Spice') {
    return { type: 'Spice', ...(frame !== undefined ? { frame } : {}) };
  }

  if (type === 'Fixed') {
    const q = raw['quaternion'];
    if (!Array.isArray(q) || q.length !== 4 || !q.every((n) => typeof n === 'number')) {
      throw new CatalogError('Fixed rotation requires a 4-element quaternion', `${location}.quaternion`);
    }
    return {
      type: 'Fixed',
      quaternion: [q[0] as number, q[1] as number, q[2] as number, q[3] as number],
      ...(frame !== undefined ? { frame } : {}),
    };
  }

  if (type === 'UniformRotation') {
    const axis = asVec3(raw['axis']);
    const ratePerSec = asNumber(raw['ratePerSec']) ?? asNumber(raw['rate']) ?? asNumber(raw['rotationRate']);
    const epoch = asString(raw['epoch']);
    if (axis === undefined || ratePerSec === undefined) {
      throw new CatalogError('UniformRotation requires an axis and a rate', `${location}.axis`);
    }
    return {
      type: 'UniformRotation',
      axis,
      ratePerSec,
      ...(epoch !== undefined ? { epoch } : {}),
      ...(frame !== undefined ? { frame } : {}),
    };
  }

  if (type === 'TwoVector') {
    const primaryRaw = raw['primary'] ?? raw['primaryAxis'];
    const secondaryRaw = raw['secondary'] ?? raw['secondaryAxis'];
    if (primaryRaw === undefined || secondaryRaw === undefined) {
      throw new CatalogError(
        'TwoVector rotation requires primary and secondary reference directions',
        `${location}.primary`,
      );
    }
    return {
      type: 'TwoVector',
      primary: cosmographiaReferenceDirection(primaryRaw, `${location}.primary`),
      secondary: cosmographiaReferenceDirection(secondaryRaw, `${location}.secondary`),
      ...(frame !== undefined ? { frame } : {}),
    };
  }

  throw new CatalogError(`Unsupported rotationModel type "${String(type)}"`, `${location}.type`);
}

/** Map a Cosmographia label record onto the native label. */
function cosmographiaLabelToNative(raw: unknown): Label | undefined {
  if (!isRecord(raw)) return undefined;
  const text = asString(raw['text']) ?? asString(raw['label']);
  const color = asColor(raw['color']) ?? asColor(raw['labelColor']);
  const showRaw = raw['show'] ?? raw['showLabel'];
  const label: Label = {
    ...(text !== undefined ? { text } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(typeof showRaw === 'boolean' ? { show: showRaw } : {}),
  };
  return Object.keys(label).length > 0 ? label : undefined;
}

/** Map a Cosmographia trajectoryPlot record onto the native trajectoryPlot. */
function cosmographiaTrajectoryPlotToNative(raw: unknown): TrajectoryPlot | undefined {
  if (!isRecord(raw)) return undefined;
  const duration = asDuration(raw['duration']);
  const lead = asDuration(raw['lead']);
  const trail = asDuration(raw['trail']);
  const sampleCount = asInt(raw['sampleCount']);
  const color = asColor(raw['color']);
  const fade = asNumber(raw['fade']);
  const plot: TrajectoryPlot = {
    ...(duration !== undefined ? { duration } : {}),
    ...(lead !== undefined ? { lead } : {}),
    ...(trail !== undefined ? { trail } : {}),
    ...(sampleCount !== undefined ? { sampleCount } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(fade !== undefined ? { fade } : {}),
  };
  return Object.keys(plot).length > 0 ? plot : undefined;
}

/** Map a Cosmographia mass (string or { value, unit }) onto the native dual form. */
function cosmographiaMassToNative(raw: unknown): Mass | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (isRecord(raw) && typeof raw['value'] === 'number' && typeof raw['unit'] === 'string') {
    return { value: raw['value'], unit: raw['unit'] };
  }
  return undefined;
}

// The item classes we treat as instruments and observations rather than as a
// body/spacecraft. Everything else is a body (no trajectory) or a spacecraft (has
// a trajectory), matching the Section 16 classification rule.
const SENSOR_CLASSES = new Set(['sensor', 'instrument']);
const OBSERVATION_CLASSES = new Set(['observation']);
// Natural-body classes are always bodies, even with a trajectory (a moon orbits).
// A bare trajectory with no body class is treated as a spacecraft.
const BODY_CLASSES = new Set([
  // 'body' is the generic, round-trip-stable class toCosmographia emits for a native
  // body so the body-vs-spacecraft split survives native->cosmo->native (a body with
  // an ephemeris trajectory stays a body rather than being reclassified a spacecraft).
  'body',
  'planet',
  'dwarfplanet',
  'moon',
  'satellite',
  'asteroid',
  'comet',
  'star',
  'barycenter',
]);

/** True when an item declares a trajectory we should map (it is a spacecraft). */
function hasTrajectory(item: Record<string, unknown>): boolean {
  return isRecord(item['trajectory']);
}

/**
 * Map the geometry of one item, failing loudly when a geometry block is present
 * but its type is unsupported (never a silent drop).
 */
function itemGeometry(item: Record<string, unknown>, loc: string): Geometry | undefined {
  if (!('geometry' in item) || item['geometry'] === undefined) return undefined;
  const geometry = cosmographiaGeometryToNative(item['geometry']);
  if (geometry === null) {
    const type = isRecord(item['geometry']) ? String(item['geometry']['type']) : 'unknown';
    throw new CatalogError(`Unsupported geometry type "${type}"`, `${loc}.geometry`);
  }
  return geometry;
}

// The shared, non-trajectory item fields (label, orientation, geometry, plot, mass).
function commonItemFields(
  item: Record<string, unknown>,
  loc: string,
): {
  label?: Label;
  orientation?: Orientation;
  geometry?: Geometry;
  trajectoryPlot?: TrajectoryPlot;
  mass?: Mass;
} {
  const label = cosmographiaLabelToNative(item['label']);
  const orientation = item['rotationModel'] !== undefined
    ? cosmographiaRotationToNative(item['rotationModel'], `${loc}.rotationModel`)
    : undefined;
  const geometry = itemGeometry(item, loc);
  const trajectoryPlot = cosmographiaTrajectoryPlotToNative(item['trajectoryPlot']);
  const mass = cosmographiaMassToNative(item['mass']);
  return {
    ...(label !== undefined ? { label } : {}),
    ...(orientation !== undefined ? { orientation } : {}),
    ...(geometry !== undefined ? { geometry } : {}),
    ...(trajectoryPlot !== undefined ? { trajectoryPlot } : {}),
    ...(mass !== undefined ? { mass } : {}),
  };
}

/** Build a native body from a Cosmographia item with no trajectory. */
function itemToBody(item: Record<string, unknown>, loc: string): CatalogBody {
  const name = requireString(item['name'], `${loc}.name`);
  const id = asString(item['id']) ?? name;
  const trajectory = hasTrajectory(item)
    ? cosmographiaTrajectoryToNative(item['trajectory'], `${loc}.trajectory`)
    : undefined;
  return {
    id,
    name,
    ...(trajectory !== undefined ? { trajectory } : {}),
    ...commonItemFields(item, loc),
  };
}

/** Build a native spacecraft from a Cosmographia item. A start/end window maps to a
 *  single arc (so the scene can bound sampling); otherwise the bare trajectory is used. */
function itemToSpacecraft(item: Record<string, unknown>, loc: string): CatalogSpacecraft {
  const name = requireString(item['name'], `${loc}.name`);
  const id = asString(item['id']) ?? name;
  const trajectory = cosmographiaTrajectoryToNative(item['trajectory'], `${loc}.trajectory`);
  const common = commonItemFields(item, loc);
  const start = asString(item['startTime']) ?? asString(item['beginning']);
  const stop = asString(item['endTime']) ?? asString(item['ending']);
  if (start !== undefined && stop !== undefined) {
    // A bounded window becomes a single arc; the orientation rides on the arc and
    // is dropped from the top level so the schema's trajectory-xor-arcs holds.
    const { orientation, ...rest } = common;
    return {
      id,
      name,
      arcs: [
        {
          timeRange: { start, stop },
          trajectory,
          ...(orientation !== undefined ? { orientation } : {}),
        },
      ],
      ...rest,
    };
  }
  return { id, name, trajectory, ...common };
}

/** Read a Cosmographia sensor item into a native instrument (targets collapsed). */
function itemToInstrument(item: Record<string, unknown>, loc: string): CatalogInstrument {
  const id = asString(item['id']) ?? requireString(item['name'], `${loc}.name`);
  const parent = asString(item['parent']) ?? asString(item['attachedTo']) ?? asString(item['spacecraft']);
  if (parent === undefined) {
    throw new CatalogError(`Sensor "${id}" is missing a parent (attachedTo)`, `${loc}.parent`);
  }
  const sensor = asString(item['sensor']) ?? asString(item['sensorFrame']) ?? id;
  const targets = collectTargets(item, loc);
  return { id, parent, sensor, targets };
}

/** Collect the target ids a sensor points at, from a single `target` or a `targets` array. */
function collectTargets(item: Record<string, unknown>, loc: string): readonly string[] {
  const single = asString(item['target']);
  const many = item['targets'];
  const targets: string[] = [];
  if (single !== undefined) targets.push(single);
  if (Array.isArray(many)) {
    many.forEach((t, i) => targets.push(requireString(t, `${loc}.targets[${i}]`)));
  }
  if (targets.length === 0) {
    throw new CatalogError(`Sensor "${asString(item['id']) ?? '?'}" needs at least one target`, `${loc}.targets`);
  }
  // De-dup while preserving order so repeated per-target sensor items collapse cleanly.
  return [...new Set(targets)];
}

/** Read a Cosmographia observation item into a native observation. */
function itemToObservation(item: Record<string, unknown>, loc: string): CatalogObservation {
  const instrument = asString(item['instrument']) ?? asString(item['sensor']);
  const target = asString(item['target']);
  if (instrument === undefined) {
    throw new CatalogError('Observation is missing an instrument', `${loc}.instrument`);
  }
  if (target === undefined) {
    throw new CatalogError('Observation is missing a target', `${loc}.target`);
  }
  const intervalsRaw = item['intervals'];
  const intervals: TimeRange[] = [];
  if (Array.isArray(intervalsRaw)) {
    intervalsRaw.forEach((iv, i) => intervals.push(asTimeRange(iv, `${loc}.intervals[${i}]`)));
  }
  if (intervals.length === 0) {
    throw new CatalogError('Observation requires at least one interval', `${loc}.intervals`);
  }
  const footprintColor = asColor(item['footprintColor']);
  return {
    instrument,
    target,
    intervals,
    ...(footprintColor !== undefined ? { footprintColor } : {}),
  };
}

/**
 * Turn a full, multi-item Cosmographia catalog into a native BesselCatalog. Every
 * item is classified (sensor/observation by class, spacecraft when it has a
 * trajectory, else body) and its geometry, trajectory, rotationModel, label,
 * trajectoryPlot, and mass are mapped. The assembled catalog is then validated via
 * parseBesselCatalog (async, ajv-backed), so the output is guaranteed schema-valid
 * and cross-referenced; any bad reference throws a located CatalogError.
 */
export async function fromCosmographia(raw: unknown): Promise<BesselCatalog> {
  if (!isRecord(raw)) throw new CatalogError('Catalog root must be an object', '$');
  const items = raw['items'];
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogError('Catalog must have a non-empty items array', '$.items');
  }

  const bodies: CatalogBody[] = [];
  const spacecraft: CatalogSpacecraft[] = [];
  const instruments: CatalogInstrument[] = [];
  const observations: CatalogObservation[] = [];

  items.forEach((item, i) => {
    const loc = `$.items[${i}]`;
    if (!isRecord(item)) throw new CatalogError('Catalog item must be an object', loc);
    const cls = asString(item['class'])?.toLowerCase();
    if (cls !== undefined && SENSOR_CLASSES.has(cls)) {
      instruments.push(itemToInstrument(item, loc));
    } else if (cls !== undefined && OBSERVATION_CLASSES.has(cls)) {
      observations.push(itemToObservation(item, loc));
    } else if (cls !== undefined && BODY_CLASSES.has(cls)) {
      // A natural body, even when it carries an ephemeris trajectory (e.g. a moon).
      bodies.push(itemToBody(item, loc));
    } else if (cls === 'spacecraft' || hasTrajectory(item)) {
      spacecraft.push(itemToSpacecraft(item, loc));
    } else {
      bodies.push(itemToBody(item, loc));
    }
  });

  // Cosmographia sensors attach to their parent by display name; the native model
  // cross-references by id. Build a name/id -> id index from the bodies and
  // spacecraft so a sensor parent given as a name resolves to the parent's id.
  const idByRef = new Map<string, string>();
  for (const b of [...bodies, ...spacecraft]) {
    idByRef.set(b.id, b.id);
    if (b.name) idByRef.set(b.name, b.id);
  }
  const resolvedInstruments = instruments.map((inst) => {
    const parent = idByRef.get(inst.parent) ?? inst.parent;
    return parent === inst.parent ? inst : { ...inst, parent };
  });

  // Collapse instruments that share an id (Cosmographia explodes one sensor into
  // one file per target) into a single instrument carrying the union of targets.
  const mergedInstruments = mergeInstruments(resolvedInstruments);

  const kernelsRaw = raw['spiceKernels'];
  const paths =
    kernelsRaw === undefined
      ? undefined
      : Array.isArray(kernelsRaw)
        ? kernelsRaw.map((k, i) => requireString(k, `$.spiceKernels[${i}]`))
        : (() => {
            throw new CatalogError('spiceKernels must be an array', '$.spiceKernels');
          })();

  const assembled: BesselCatalog = {
    version: asString(raw['version']) ?? '1.0',
    ...(asString(raw['name']) !== undefined ? { name: asString(raw['name'])! } : {}),
    ...(paths !== undefined ? { kernels: { paths } } : {}),
    ...(bodies.length > 0 ? { bodies } : {}),
    ...(spacecraft.length > 0 ? { spacecraft } : {}),
    ...(mergedInstruments.length > 0 ? { instruments: mergedInstruments } : {}),
    ...(observations.length > 0 ? { observations } : {}),
  };

  // Validate the assembled output against the schema (and cross references). This is
  // the loud gate: a bad parent/instrument reference or a malformed branch throws a
  // located CatalogError rather than producing an unrenderable catalog.
  return parseBesselCatalog(assembled);
}

// The export side (the inverse of fromCosmographia on the lossless subset) lives in
// its own module to keep this file focused on import; it is re-exported here so the
// full Cosmographia compatibility surface is reachable from one place.
export { toCosmographia } from './cosmographia-export.ts';
export type { CosmographiaExport, CosmographiaExportItem } from './cosmographia-export.ts';

/** Merge instruments sharing an id, unioning their target lists in first-seen order. */
function mergeInstruments(instruments: readonly CatalogInstrument[]): CatalogInstrument[] {
  const byId = new Map<string, { base: CatalogInstrument; targets: string[] }>();
  for (const inst of instruments) {
    const existing = byId.get(inst.id);
    if (existing) {
      for (const t of inst.targets) if (!existing.targets.includes(t)) existing.targets.push(t);
    } else {
      byId.set(inst.id, { base: inst, targets: [...inst.targets] });
    }
  }
  return [...byId.values()].map(({ base, targets }) => ({ ...base, targets }));
}
