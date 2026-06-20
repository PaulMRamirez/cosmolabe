// @bessel/catalog: Cosmographia catalog parser, the native Bessel schema, and a
// round-trip compatibility layer (ADR-0006). Phase 0 parses a single spacecraft
// catalog; Phase 1 covers the full geometry taxonomy and schema validation.

export interface TrajectoryPoint {
  readonly et: number;
  readonly position: readonly [number, number, number];
}

export interface SpacecraftCatalog {
  readonly name: string;
  /** SPICE body id or name used for ephemeris lookups. */
  readonly spiceId: string;
  /** Reference frame for the trajectory, default J2000. */
  readonly frame: string;
  /** Center body the trajectory is expressed relative to. */
  readonly center: string;
  /** Kernels this catalog requires, by logical name. */
  readonly kernels: readonly string[];
  /** Optional UTC coverage hints used to bound trajectory sampling. */
  readonly startTime?: string;
  readonly endTime?: string;
}

/** Located, typed catalog error naming the offending field (loud failure). */
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly location: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export { parseCosmographiaCatalog } from './cosmographia.ts';
export type { CosmographiaCatalog, CosmographiaItem } from './cosmographia.ts';

export {
  parseBesselCatalog,
  validateCatalog,
  schemaIsValid,
  type ValidationResult,
} from './validator.ts';
export { resolveCatalogKernels } from './kernels.ts';
export { PluginRegistry, type MissionPlugin, type KernelRef } from './plugins.ts';
export * from './native-types.ts';
