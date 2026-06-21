// A focused entry point for catalog-trajectory sampling: just the analytic TLE/SGP4,
// mean-element, and TEME->J2000 functions a viewer needs to turn a Keplerian or TLE
// element set into a position track. Importing this instead of the package barrel
// keeps the heavy force-model / Cowell / MCS graph out of a consumer's chunk, so a
// shell that lazy-loads only trajectory sampling does not pull the analysis engines.

export { parseTle, TleError, type Tle } from './tle.ts';
export { sgp4init, sgp4, type SatRec, type TemeState } from './sgp4.ts';
export {
  propagateMeanElements,
  type EphemerisTable,
  type ClassicalElements,
  type CentralBody,
} from './elements.ts';
export { temeToJ2000AtEt, type EarthOrientation } from './frames/teme.ts';
