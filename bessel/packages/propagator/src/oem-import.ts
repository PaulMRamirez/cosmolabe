// Import a parsed CCSDS OEM (an ephemeris message) as an in-memory SPK Type-13
// segment, so externally-supplied ephemerides render through the same spkpos pipeline
// as any other body. Bridges @bessel/interop's parseOem to publishEphemeris. Takes a
// structural OemLike shape (no @bessel/interop dependency). (STK_PARITY_SPEC §4.11.)

import type { SpiceEngine } from '@bessel/spice';
import { emptyTable, publishEphemeris, type EphemerisTable } from './elements.ts';

/** The subset of a parsed OEM this importer needs (structurally a CCSDS Oem). */
export interface OemLike {
  readonly metadata: { readonly refFrame?: string };
  readonly states: ReadonlyArray<{
    readonly epoch: string;
    readonly position: readonly [number, number, number];
    readonly velocity: readonly [number, number, number];
  }>;
}

export interface OemImportOptions {
  /** SPK file name in the in-memory FS. */
  readonly name: string;
  /** NAIF id for the imported body (e.g. a negative spacecraft id). */
  readonly body: number;
  /** NAIF id of the segment center body. */
  readonly center: number;
  readonly degree?: number;
}

/** CCSDS reference-frame names that are the SPICE inertial frame J2000. */
const J2000_ALIASES = new Set(['EME2000', 'J2000', 'ICRF', 'GCRF']);

/**
 * Build an EphemerisTable from an OEM (converting each epoch to ET) and publish it as
 * an SPK Type-13 segment. Returns the table. The OEM REF_FRAME is mapped to a SPICE
 * frame (EME2000/ICRF/GCRF -> J2000); an unknown frame is passed through as-is.
 */
export async function publishOem(
  spice: SpiceEngine,
  oem: OemLike,
  opts: OemImportOptions,
): Promise<EphemerisTable> {
  const n = oem.states.length;
  if (n < 2) throw new Error(`OEM import needs at least 2 states, got ${n}`);
  const refFrame = oem.metadata.refFrame ?? 'J2000';
  const frame = J2000_ALIASES.has(refFrame.toUpperCase()) ? 'J2000' : refFrame;

  // Resolve every epoch to ET first (SPICE str2et rejects a trailing 'Z'), then build
  // the table over that grid and fill the states.
  const et = new Float64Array(n);
  for (let i = 0; i < n; i++) et[i] = await spice.str2et(oem.states[i]!.epoch.replace(/Z$/, ''));
  const table = emptyTable(frame, et);
  for (let i = 0; i < n; i++) {
    const s = oem.states[i]!;
    (table.x as Float64Array)[i] = s.position[0];
    (table.y as Float64Array)[i] = s.position[1];
    (table.z as Float64Array)[i] = s.position[2];
    (table.vx as Float64Array)[i] = s.velocity[0];
    (table.vy as Float64Array)[i] = s.velocity[1];
    (table.vz as Float64Array)[i] = s.velocity[2];
  }
  await publishEphemeris(spice, table, { name: opts.name, body: opts.body, center: opts.center, degree: opts.degree });
  return table;
}
