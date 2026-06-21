// Sample a TLE trajectory into a flat position table relative to the center body.
// Reuses the @bessel/propagator SGP4 path (parseTle -> sgp4init -> sgp4) and the
// EOP-aware TEME -> J2000 transform; no orbital math is reimplemented here. The
// SGP4 state is geocentric (J2000, Earth-centered), so when the requested center
// is not Earth the Earth->center offset is added in from SPICE. The heavy
// propagator is imported dynamically so this code lands in the lazy analysis
// bundle, never the first-paint shell.

import type { SpiceEngine } from '@bessel/spice';
import { TrajectoryError, fillTable, type PositionTable } from './shared.ts';

/** Seconds per minute, for the SGP4 tsince argument (minutes since epoch). */
const SEC_PER_MIN = 60;

/**
 * Sample a TLE over the ET grid into a J2000 position table relative to `centerId`.
 * Earth (399) is the natural SGP4 center; a different center adds the center->Earth
 * vector from SPICE. Fails loudly on a malformed TLE.
 */
export async function sampleTle(
  spice: SpiceEngine,
  line1: string,
  line2: string,
  etGrid: Float64Array,
  centerId: string,
): Promise<PositionTable> {
  const { parseTle, sgp4init, sgp4, temeToJ2000AtEt } = await import('@bessel/propagator/samplers');
  let rec;
  let epochEt: number;
  try {
    const tle = parseTle(line1, line2);
    rec = sgp4init(tle);
    epochEt = await spice.str2et(tle.epochUtc.replace(/Z$/, ''));
  } catch (err) {
    throw new TrajectoryError('Tle', `cannot parse or initialize: ${(err as Error).message}`, err);
  }

  // The SGP4 + TEME->J2000 chain yields an Earth-centered (399) J2000 position. When
  // the catalog asks for a non-Earth center, add Earth's J2000 position relative to
  // that center at each epoch (spkpos), so the polyline anchors correctly.
  const earthCentered = centerId === '399' || centerId.toUpperCase() === 'EARTH';
  const offsets = earthCentered
    ? null
    : await Promise.all(
        Array.from({ length: etGrid.length }, (_, k) =>
          spice.spkpos('399', etGrid[k]!, 'J2000', 'NONE', centerId),
        ),
      );

  return fillTable(etGrid, (k) => {
    const teme = sgp4(rec, (etGrid[k]! - epochEt) / SEC_PER_MIN);
    const { position } = temeToJ2000AtEt(teme, etGrid[k]!);
    if (!offsets) return position;
    const o = offsets[k]!.position;
    return [position[0] + o.x, position[1] + o.y, position[2] + o.z];
  });
}
