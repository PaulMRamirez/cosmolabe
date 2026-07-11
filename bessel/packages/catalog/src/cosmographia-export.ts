// Cosmographia exporter (Section 16 export design, Phase E). toCosmographia is the
// inverse of fromCosmographia on the lossless subset: it turns a native
// BesselCatalog back into the single-manifest Cosmographia "items" array form so a
// Cosmographia user can round-trip. Constructs outside the lossless subset are
// never silently dropped; each raises a typed, located CatalogWarning.

import { CatalogWarning } from './index.ts';
import type {
  BesselCatalog,
  CatalogBody,
  CatalogInstrument,
  CatalogObservation,
  CatalogSpacecraft,
  Geometry,
  Orientation,
  Trajectory,
} from './native-types.ts';

/** A single exported Cosmographia item (manifest form). Open shape: only the keys
 *  that a given item needs are present, mirroring a real Cosmographia catalog. */
export type CosmographiaExportItem = Record<string, unknown>;

/** The exported Cosmographia manifest plus the warnings raised for lossy constructs. */
export interface CosmographiaExport {
  readonly catalog: {
    readonly version: string;
    readonly name?: string;
    readonly spiceKernels?: readonly string[];
    readonly items: readonly CosmographiaExportItem[];
  };
  readonly warnings: readonly CatalogWarning[];
}

/** A passthrough bag preserved verbatim across the round-trip. */
const BESSEL_EXTRA = 'besselExtra';

function defined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** Invert cosmographiaTrajectoryToNative. The native union already uses the schema
 *  (canonical) type names, so the names map 1:1 back to Cosmographia. */
function trajectoryToCosmographia(t: Trajectory): CosmographiaExportItem {
  const shared = defined({ center: t.center, frame: t.frame });
  switch (t.type) {
    case 'Spice':
      return defined({ type: 'Spice', target: t.target, ...shared });
    case 'Keplerian':
      return defined({ type: 'Keplerian', elements: { ...t.elements }, mu: t.mu, ...shared });
    case 'Tle':
      return defined({ type: 'Tle', line1: t.line1, line2: t.line2, ...shared });
    case 'Fixed':
      return defined({ type: 'Fixed', position: [...t.position], ...shared });
    case 'Sampled':
      return defined({ type: 'Sampled', source: t.source, format: t.format, ...shared });
  }
}

/** Invert cosmographiaRotationToNative. */
function rotationToCosmographia(o: Orientation): CosmographiaExportItem {
  const frame = o.frame;
  switch (o.type) {
    case 'Spice':
      return defined({ type: 'Spice', frame });
    case 'Fixed':
      return defined({ type: 'Fixed', quaternion: o.quaternion ? [...o.quaternion] : undefined, frame });
    case 'UniformRotation':
      return defined({
        type: 'UniformRotation',
        axis: o.axis ? [...o.axis] : undefined,
        ratePerSec: o.ratePerSec,
        epoch: o.epoch,
        frame,
      });
    case 'TwoVector':
      return defined({
        type: 'TwoVector',
        primary: o.primary ? defined({ ...o.primary }) : undefined,
        secondary: o.secondary ? defined({ ...o.secondary }) : undefined,
        frame,
      });
  }
}

/** Invert cosmographiaGeometryToNative for the lossless geometry subset. Globe's
 *  `texture` re-emits as Cosmographia's `baseMap`; a nested Rings re-emits nested. */
function geometryToCosmographia(g: Geometry, location: string, warn: (w: CatalogWarning) => void): CosmographiaExportItem {
  switch (g.type) {
    case 'Globe': {
      const lossyKeys = (['cloudMap', 'cloudAltitudeKm', 'specularColor', 'specularPower', 'emissive'] as const).filter(
        (k) => g[k] !== undefined,
      );
      if (lossyKeys.length > 0) {
        warn(
          new CatalogWarning(
            `Globe geometry fields [${lossyKeys.join(', ')}] have no schema-valid Cosmographia round-trip and are emitted best-effort`,
            `${location}.geometry`,
          ),
        );
      }
      return defined({
        type: 'Globe',
        radii: g.radii ? [...g.radii] : undefined,
        baseMap: g.texture,
        nightTexture: g.nightTexture,
        normalMap: g.normalMap,
        atmosphere: g.atmosphere ? { ...g.atmosphere } : undefined,
        rings: g.rings
          ? defined({ type: 'Rings', innerRadius: g.rings.innerRadius, outerRadius: g.rings.outerRadius, texture: g.rings.texture })
          : undefined,
        cloudMap: g.cloudMap,
        specularColor: g.specularColor,
        specularPower: g.specularPower,
        emissive: g.emissive,
      });
    }
    case 'Rings':
      return defined({ type: 'Rings', innerRadius: g.innerRadius, outerRadius: g.outerRadius, texture: g.texture });
    case 'Mesh':
      return defined({ type: 'Mesh', source: g.source, scale: g.scale });
    case 'DSK':
      warn(
        new CatalogWarning(
          'DSK geometry has no schema-validated native form and is emitted best-effort (lossy)',
          `${location}.geometry`,
        ),
      );
      return defined({ type: 'DSK', source: g.source, scale: g.scale });
    case 'ParticleSystem':
      return defined({ type: 'ParticleSystem', source: g.source, particleCount: g.particleCount });
    case 'KeplerianSwarm':
      return defined({ type: 'KeplerianSwarm', source: g.source, color: g.color });
    case 'TimeSwitched':
      return defined({
        type: 'TimeSwitched',
        segments: g.segments.map((seg, i) => ({
          timeRange: { ...seg.timeRange },
          geometry: geometryToCosmographia(seg.geometry, `${location}.geometry.segments[${i}]`, warn),
        })),
      });
  }
}

/** mass re-emits verbatim (string or { value, unit }). */
function massToCosmographia(m: CatalogBody['mass']): unknown {
  if (m === undefined) return undefined;
  return typeof m === 'string' ? m : { value: m.value, unit: m.unit };
}

/** The shared visual fields every item may carry. */
function commonFields(
  item: CatalogBody | CatalogSpacecraft,
  location: string,
  warn: (w: CatalogWarning) => void,
): CosmographiaExportItem {
  return defined({
    label: item.label ? defined({ ...item.label }) : undefined,
    geometry: item.geometry ? geometryToCosmographia(item.geometry, location, warn) : undefined,
    trajectoryPlot: item.trajectoryPlot ? defined({ ...item.trajectoryPlot }) : undefined,
    mass: massToCosmographia(item.mass),
    [BESSEL_EXTRA]: (item as { besselExtra?: unknown }).besselExtra,
  });
}

/** A natural body. Exported with the generic `class: 'body'` so it re-imports as a
 *  body (not a spacecraft) even when it carries an ephemeris trajectory. The specific
 *  Cosmographia class (planet/moon/comet) is not part of the lossless subset. */
function bodyToItem(body: CatalogBody, location: string, warn: (w: CatalogWarning) => void): CosmographiaExportItem {
  return defined({
    class: 'body',
    name: body.name ?? body.id,
    id: body.id,
    ...commonFields(body, location, warn),
    trajectory: body.trajectory ? trajectoryToCosmographia(body.trajectory) : undefined,
    rotationModel: body.orientation ? rotationToCosmographia(body.orientation) : undefined,
  });
}

/** A spacecraft. A single bounded arc inverts to startTime/endTime + flat trajectory
 *  + rotationModel; a multi-arc spacecraft cannot be a single Cosmographia item, so
 *  the extra arcs are recorded as a loud CatalogWarning rather than dropped. */
function spacecraftToItem(
  sc: CatalogSpacecraft,
  location: string,
  warn: (w: CatalogWarning) => void,
): CosmographiaExportItem {
  const base: CosmographiaExportItem = {
    class: 'spacecraft',
    name: sc.name ?? sc.id,
    id: sc.id,
    ...commonFields(sc, location, warn),
  };

  if (sc.arcs && sc.arcs.length > 0) {
    if (sc.arcs.length > 1) {
      warn(
        new CatalogWarning(
          `Spacecraft "${sc.id}" has ${sc.arcs.length} arcs; Cosmographia's single-trajectory item form can express only the first (lossy on extra arcs)`,
          `${location}.arcs`,
        ),
      );
    }
    const arc = sc.arcs[0]!;
    return defined({
      ...base,
      startTime: arc.timeRange?.start,
      endTime: arc.timeRange?.stop,
      trajectory: trajectoryToCosmographia(arc.trajectory),
      rotationModel: arc.orientation ? rotationToCosmographia(arc.orientation) : undefined,
    });
  }

  return defined({
    ...base,
    trajectory: sc.trajectory ? trajectoryToCosmographia(sc.trajectory) : undefined,
    rotationModel: sc.orientation ? rotationToCosmographia(sc.orientation) : undefined,
  });
}

/** Re-expand one collapsed instrument into per-target Cosmographia sensor items. The
 *  per-target file/item names are synthesized (lossy on names, lossless on content),
 *  which is recorded as a CatalogWarning when more than one target is expanded. */
function instrumentToItems(
  inst: CatalogInstrument,
  warn: (w: CatalogWarning) => void,
): CosmographiaExportItem[] {
  if (inst.targets.length > 1) {
    warn(
      new CatalogWarning(
        `Instrument "${inst.id}" re-expands into ${inst.targets.length} per-target sensor items; their file/item names are synthesized, not preserved (lossy on names only)`,
        `$.instruments[id=${inst.id}]`,
      ),
    );
  }
  return inst.targets.map((target) =>
    defined({
      class: 'sensor',
      id: inst.id,
      name: inst.id,
      parent: inst.parent,
      sensor: inst.sensor,
      target,
      fov: inst.fov ? { ...inst.fov } : undefined,
    }),
  );
}

function observationToItem(obs: CatalogObservation): CosmographiaExportItem {
  return defined({
    class: 'observation',
    instrument: obs.instrument,
    target: obs.target,
    intervals: obs.intervals ? obs.intervals.map((iv) => ({ ...iv })) : undefined,
    footprintColor: obs.footprintColor,
  });
}

/**
 * Export a native BesselCatalog back to the single-manifest Cosmographia "items"
 * form, the inverse of fromCosmographia on the lossless subset. Returns the catalog
 * plus the list of CatalogWarnings raised for constructs that fall outside the
 * lossless subset (never a silent drop). `kernels.baseUrl`/`metaKernels`, which the
 * flat Cosmographia `spiceKernels` array cannot express, are warned and only the
 * `paths` array is emitted.
 */
export function toCosmographia(catalog: BesselCatalog): CosmographiaExport {
  const warnings: CatalogWarning[] = [];
  const warn = (w: CatalogWarning): void => {
    warnings.push(w);
  };

  const items: CosmographiaExportItem[] = [];
  (catalog.bodies ?? []).forEach((b, i) => items.push(bodyToItem(b, `$.bodies[${i}]`, warn)));
  (catalog.spacecraft ?? []).forEach((s, i) => items.push(spacecraftToItem(s, `$.spacecraft[${i}]`, warn)));
  (catalog.instruments ?? []).forEach((inst) => items.push(...instrumentToItems(inst, warn)));
  (catalog.observations ?? []).forEach((obs) => items.push(observationToItem(obs)));

  const kernels = catalog.kernels;
  if (kernels?.baseUrl !== undefined || (kernels?.metaKernels && kernels.metaKernels.length > 0)) {
    warn(
      new CatalogWarning(
        'kernels.baseUrl / kernels.metaKernels have no flat Cosmographia spiceKernels equivalent and are not emitted (lossy)',
        '$.kernels',
      ),
    );
  }
  const spiceKernels = kernels?.paths;

  return {
    catalog: defined({
      version: catalog.version,
      name: catalog.name,
      spiceKernels: spiceKernels && spiceKernels.length > 0 ? [...spiceKernels] : undefined,
      items,
    }) as CosmographiaExport['catalog'],
    warnings,
  };
}
