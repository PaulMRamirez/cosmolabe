// Sample a Keplerian trajectory into a flat position table relative to the center.
// Reuses @bessel/propagator propagateMeanElements (which advances the mean elements
// and converts to a state via CSPICE conics each step); the catalog declares no J2,
// so with j2 = 0 the secular rates reduce to pure two-body motion. The center GM is
// the catalog `mu`, else the center body's PCK GM, else a heliocentric/geocentric
// fallback. The heavy propagator is imported dynamically so this lands in the lazy
// analysis bundle, never the first-paint shell.

import type { SpiceEngine } from '@bessel/spice';
import type { KeplerianElements } from '@bessel/catalog';
import { TrajectoryError, fillTable, type PositionTable } from './shared.ts';

/**
 * Sample Keplerian elements over the ET grid into a J2000 position table relative to
 * the center. `mu` overrides the resolved GM when present. Pure two-body (j2 = 0).
 * Fails loudly when the central GM cannot be resolved or the elements are degenerate.
 */
export async function sampleKeplerian(
  spice: SpiceEngine,
  elements: KeplerianElements,
  etGrid: Float64Array,
  centerId: string,
  mu: number | undefined,
): Promise<PositionTable> {
  const { propagateMeanElements } = await import('@bessel/propagator/samplers');

  const gm = mu ?? (await resolveGm(spice, centerId));
  if (!Number.isFinite(gm) || gm <= 0) {
    throw new TrajectoryError('Keplerian', `central GM for "${centerId}" is not resolvable`);
  }
  if (!(elements.a > 0)) {
    throw new TrajectoryError('Keplerian', `semi-major axis must be positive, got ${elements.a}`);
  }

  let epoch: number;
  try {
    epoch = await spice.str2et(elements.epoch.replace(/Z$/, ''));
  } catch (err) {
    throw new TrajectoryError('Keplerian', `cannot parse epoch "${elements.epoch}"`, err);
  }

  // j2 = 0, re = 0 => secularRatesJ2 reduces to (0, 0, n0): clean two-body motion.
  const table = await propagateMeanElements(
    spice,
    { a: elements.a, e: elements.e, i: elements.i, raan: elements.raan, argp: elements.argp, m0: elements.m0, epoch },
    { gm, j2: 0, re: 0 },
    etGrid,
  );

  return fillTable(etGrid, (k) => [table.x[k]!, table.y[k]!, table.z[k]!]);
}

/** The center body's GM (km^3/s^2) from the PCK, or throw if unavailable. */
async function resolveGm(spice: SpiceEngine, centerId: string): Promise<number> {
  try {
    const gm = await spice.bodvrd(centerId, 'GM');
    if (gm.length > 0 && Number.isFinite(gm[0])) return gm[0]!;
  } catch {
    // Fall through to the loud failure in the caller.
  }
  return Number.NaN;
}
