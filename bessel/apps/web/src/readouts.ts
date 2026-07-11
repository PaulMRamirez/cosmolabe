// Geometric readouts computed via @bessel/spice: range (spkpos magnitude) and the
// solar phase, incidence, and emission angles at the sub-observer point (ilumin).
// Illumination needs a body-fixed frame and a shape, so it is attempted only for
// bodies that have one and falls back to nulls otherwise (no silent wrong values).
import type { Readouts } from '@bessel/ui';
import type { SpiceEngine } from '@bessel/spice';
import type { BesselCatalog } from '@bessel/catalog';
import { RAD2DEG } from './angles.ts';

/** Build a body-name/id -> declared body-fixed frame map from a catalog's bodies.
 *  Only bodies that declare a Spice orientation frame contribute; this is the same
 *  field generic-mission.ts uses to orient rings and the instrument target frame. */
export function buildBodyFrameMap(catalog: BesselCatalog): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const b of catalog.bodies ?? []) {
    if (b.orientation?.type === 'Spice' && b.orientation.frame) {
      const frame = b.orientation.frame;
      if (b.name) map.set(b.name, frame);
      map.set(b.id, frame);
    }
  }
  return map;
}

/** Body-fixed frame for a body: the catalog-declared frame, else the IAU_<NAME>
 *  convention; null for the Sun (illumination there is degenerate). The returned
 *  frame is a candidate only: computeReadouts still fails loud to n/a if SPICE
 *  cannot resolve it against the loaded kernels. */
export function resolveBodyFrame(
  name: string,
  bodyFrames?: ReadonlyMap<string, string>,
): string | null {
  // The Sun is the light source: illumination angles on it are degenerate.
  if (name.toLowerCase() === 'sun') return null;
  const declared = bodyFrames?.get(name);
  if (declared) return declared;
  // Generic IAU convention: "Enceladus" -> "IAU_ENCELADUS"; an unknown body simply
  // fails loud to n/a if no such frame is furnished in the loaded kernels.
  return `IAU_${name.trim().toUpperCase().replace(/\s+/g, '_')}`;
}

export async function computeReadouts(
  spice: SpiceEngine,
  targetName: string,
  targetId: string,
  et: number,
  observer: string,
  bodyFrames?: ReadonlyMap<string, string>,
): Promise<Readouts> {
  const pos = await spice.spkpos(targetName, et, 'J2000', 'NONE', observer).catch(() => null);
  const rangeKm = pos ? Math.hypot(pos.position.x, pos.position.y, pos.position.z) : null;

  // Altitude above the target's surface: range minus the mean radius from the PCK
  // (bodvrd RADII). Attempted only when a range and radii are available, else n/a.
  let altitudeKm: number | null = null;
  if (rangeKm !== null) {
    const radii = await spice.bodvrd(targetName, 'RADII').catch(() => null);
    if (radii && radii.length === 3) {
      const meanRadius = (radii[0]! + radii[1]! + radii[2]!) / 3;
      altitudeKm = rangeKm - meanRadius;
    }
  }

  let phaseDeg: number | null = null;
  let incidenceDeg: number | null = null;
  let emissionDeg: number | null = null;
  const frame = resolveBodyFrame(targetName, bodyFrames);
  if (frame) {
    try {
      const sub = await spice.subpnt('NEAR POINT/ELLIPSOID', targetName, et, frame, 'NONE', observer);
      const ill = await spice.ilumin('ELLIPSOID', targetName, et, frame, 'NONE', observer, sub.point);
      phaseDeg = ill.phase * RAD2DEG;
      incidenceDeg = ill.incidence * RAD2DEG;
      emissionDeg = ill.emission * RAD2DEG;
    } catch {
      // Frame or shape unavailable for this body; leave the angles as n/a.
    }
  }
  void targetId;
  return { rangeKm, altitudeKm, phaseDeg, incidenceDeg, emissionDeg };
}
