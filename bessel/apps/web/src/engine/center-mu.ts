// Gravitational parameter of a central body, shared by the lazy analysis ops and the
// eager state-vector readout so the CENTER_GM table is defined once. Prefers the GM
// from the loaded kernel pool, falling back to a published constant for the common
// bodies (NAIF/DE440) when the kernels carry none.

import type { EngineCore } from './bootstrap.ts';

/** Gravitational parameters (km^3/s^2) for the common central bodies. Published
 *  physical constants (NAIF/DE440), not mission kernel data. */
export const CENTER_GM: Readonly<Record<string, number>> = {
  SUN: 1.32712440018e11,
  MERCURY: 2.2032e4,
  VENUS: 3.24859e5,
  EARTH: 3.986004418e5,
  MOON: 4.9028e3,
  MARS: 4.282837e4,
  JUPITER: 1.26686534e8,
  SATURN: 3.7931187e7,
  URANUS: 5.793939e6,
  NEPTUNE: 6.836529e6,
  PLUTO: 8.71e2,
};

/** Gravitational parameter (km^3/s^2) of a central body: from the kernel pool, or a
 *  built-in constant for the common bodies when the loaded kernels carry no GM. */
export async function centerMu(e: EngineCore, body: string): Promise<number | null> {
  try {
    const gm = await e.spice.bodvrd(body, 'GM');
    if (gm.length && Number.isFinite(gm[0])) return gm[0]!;
  } catch {
    // No GM in the pool; fall through to the constants table.
  }
  return CENTER_GM[body.toUpperCase()] ?? null;
}
