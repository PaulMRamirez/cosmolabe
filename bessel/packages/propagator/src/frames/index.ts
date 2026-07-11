// Frame transforms for analytic propagator output. The public surface is the EOP-aware
// TEME -> J2000 (EME2000/GCRF) rotation used to tag SGP4 states in an inertial frame,
// plus the precession (IAU-1976) and nutation (IAU-1980) primitives it is built from.
// (STK_PARITY_SPEC frames.)

export {
  temeToJ2000,
  temeToJ2000Matrix,
  temeToJ2000AtEt,
  j2000ToTeme,
  j2000ToTemeMatrix,
  type EarthOrientation,
} from './teme.ts';
export { precession } from './precession-1976.ts';
export {
  nutation,
  meanObliquity,
  NUTATION_TERM_COUNT,
  type NutationResult,
} from './nutation-1980.ts';
