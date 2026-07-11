// The HPOP force-model selector: map a user-chosen fidelity level to a concrete
// @bessel/propagator ForceModel. Each level layers terms on a point-mass core
// (point-mass -> + J2 -> + a small NxN zonal stack -> + drag -> + SRP). The drag and
// SRP terms use modeled defaults (a fixed body rotation and a fixed Sun direction)
// so the Earth-orbit HPOP path stays SPICE-free and deterministic. Units: km, km/s,
// seconds. (STK_PARITY_SPEC §4.1/§4.2.)

import {
  createForceModel,
  drag,
  exponentialAtmosphere,
  pointMass,
  srp,
  zonalHarmonics,
  type ForceModel,
} from '@bessel/propagator';

/** The fidelity levels the Propagate menu exposes for numerical (HPOP) propagation. */
export type HpopForceModel = 'point-mass' | 'j2' | 'nxn' | 'drag' | 'srp';

/** Human-readable labels for each force-model level, for the report copy. */
export const HPOP_FORCE_MODEL_LABELS: Readonly<Record<HpopForceModel, string>> = {
  'point-mass': 'point mass',
  j2: 'point mass + J2',
  nxn: 'NxN gravity (zonal J2-J4)',
  drag: 'NxN gravity + drag',
  srp: 'NxN gravity + drag + SRP',
};

export interface HpopBody {
  /** Gravitational parameter (km^3/s^2). */
  readonly gm: number;
  /** Equatorial radius (km). */
  readonly re: number;
  /** J2 zonal coefficient (dimensionless). */
  readonly j2: number;
}

// Earth J3/J4 (EGM, dimensionless), used by the NxN level as a small zonal stack so the
// "NxN gravity" choice is visibly higher fidelity than the bare J2 model.
const EARTH_J3 = -2.5326613e-6;
const EARTH_J4 = -1.6196215e-6;
// A modeled ballistic configuration for the drag and SRP terms (a 100 kg, 1 m^2
// satellite). Area is in m^2, mass in kg, the units these force terms expect.
const SAT_CD = 2.2;
const SAT_CR = 1.3;
const SAT_AREA_M2 = 1;
const SAT_MASS_KG = 100;
// A fixed inertial Sun direction (unit) at 1 AU (km). Constant over the one-day arc this
// path integrates; good enough to exercise the SRP term deterministically.
const SUN_DIR: readonly [number, number, number] = [1, 0, 0];
const ONE_AU_KM = 1.495978707e8;

/** Build the ForceModel for a given fidelity level about `body`. */
export function buildHpopForceModel(level: HpopForceModel, body: HpopBody): ForceModel {
  const terms = [pointMass(body.gm)];
  if (level === 'j2') {
    terms.push(zonalHarmonics({ gm: body.gm, re: body.re }, { j2: body.j2 }));
  }
  if (level === 'nxn' || level === 'drag' || level === 'srp') {
    terms.push(
      zonalHarmonics({ gm: body.gm, re: body.re }, { j2: body.j2, j3: EARTH_J3, j4: EARTH_J4 }),
    );
  }
  if (level === 'drag' || level === 'srp') {
    terms.push(
      drag({
        cd: SAT_CD,
        area: SAT_AREA_M2,
        mass: SAT_MASS_KG,
        atmosphere: exponentialAtmosphere({ re: body.re }),
      }),
    );
  }
  if (level === 'srp') {
    terms.push(
      srp({
        cr: SAT_CR,
        area: SAT_AREA_M2,
        mass: SAT_MASS_KG,
        sunPosition: () => [SUN_DIR[0] * ONE_AU_KM, SUN_DIR[1] * ONE_AU_KM, SUN_DIR[2] * ONE_AU_KM],
        occultingRadius: body.re,
        au: ONE_AU_KM,
      }),
    );
  }
  return createForceModel(terms);
}
