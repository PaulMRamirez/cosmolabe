// Mission timeline annotations, computed where SPICE lives (the engine/mission
// layer) and passed to the viewer as inert data so the UI never reaches into
// SPICE (the dependency rule). Two grounded sources, mirroring Cosmographia's
// trajectory arcs and the CSPICE geometry finder:
//   1. Arc boundaries: each trajectory arc start, plus the mission end, become
//      markers (an arc transition is typically a maneuver).
//   2. A SPICE-found event: the spacecraft closest approach (periapsis) to the
//      center body over the loaded window, found by scanning the range and
//      refining the minimum, the same minimum-of-a-scalar pattern the geometry
//      finder uses for access.

import { arcBoundaryAnnotations, sortByEt, type TimelineAnnotation } from '@bessel/timeline';
import type { SpiceEngine } from '@bessel/spice';
import type { CatalogSpacecraft } from '@bessel/catalog';
import { positionAt, type EphemerisTable } from '../sampler.ts';

/** Coarse periapsis scan resolution over the window (samples). */
const PERIAPSIS_SAMPLES = 240;

// CSPICE str2et reads a UTC calendar string but does not accept the ISO 8601 "Z"
// zone suffix, so strip it. The time is already UTC by SPICE convention.
function toSpiceUtc(utc: string): string {
  return utc.endsWith('Z') ? utc.slice(0, -1) : utc;
}

/** Range (km) from the spacecraft to the center body at an epoch, from the table. */
function rangeKm(table: EphemerisTable, scName: string, centerName: string, et: number): number {
  const a = positionAt(table, scName, et);
  const b = positionAt(table, centerName, et);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Find the epoch of minimum spacecraft-to-center range over [t0, t1] (closest
 * approach / periapsis). A uniform grid locates the bracketing samples, then a
 * golden-section-free ternary refine narrows the minimum. Returns null when the
 * spacecraft has no ephemeris in the table (a bodies-only mission).
 */
function findPeriapsisEt(
  table: EphemerisTable,
  scName: string,
  centerName: string,
  t0: number,
  t1: number,
): number | null {
  if (!table.byBody.has(scName) || !table.byBody.has(centerName)) return null;
  const step = (t1 - t0) / PERIAPSIS_SAMPLES;
  if (!(step > 0)) return null;
  let bestEt = t0;
  let bestR = Infinity;
  for (let i = 0; i <= PERIAPSIS_SAMPLES; i++) {
    const et = t0 + i * step;
    const r = rangeKm(table, scName, centerName, et);
    if (r < bestR) {
      bestR = r;
      bestEt = et;
    }
  }
  // Refine within one step either side by bisection on the bracketing triple.
  let lo = Math.max(t0, bestEt - step);
  let hi = Math.min(t1, bestEt + step);
  for (let i = 0; i < 40 && hi - lo > 1e-3; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (rangeKm(table, scName, centerName, m1) < rangeKm(table, scName, centerName, m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Build the mission's timeline annotations from its catalog arcs and a SPICE-found
 * periapsis. UTC arc bounds are resolved to ET via the SPICE engine (str2et), so
 * the markers land on the real ephemeris timeline. Sorted by epoch.
 */
export async function buildMissionAnnotations(
  spice: SpiceEngine,
  spacecraft: CatalogSpacecraft | null,
  centerName: string,
  table: EphemerisTable,
  window: readonly [number, number],
): Promise<TimelineAnnotation[]> {
  const scName = spacecraft?.name ?? null;
  const arcs = (spacecraft?.arcs ?? []).filter(
    (arc): arc is typeof arc & { timeRange: { start: string; stop: string } } => !!arc.timeRange,
  );
  if (!scName || arcs.length === 0) return [];

  const bounds = await Promise.all(
    arcs.map(async (arc) => ({
      start: await spice.str2et(toSpiceUtc(arc.timeRange.start)),
      stop: await spice.str2et(toSpiceUtc(arc.timeRange.stop)),
    })),
  );
  const annotations: TimelineAnnotation[] = arcBoundaryAnnotations(bounds);

  const periapsisEt = findPeriapsisEt(table, scName, centerName, window[0], window[1]);
  if (periapsisEt !== null) {
    annotations.push({
      id: 'periapsis',
      et: periapsisEt,
      label: `Closest approach to ${centerName}`,
      kind: 'observation',
    });
  }
  return sortByEt(annotations);
}
