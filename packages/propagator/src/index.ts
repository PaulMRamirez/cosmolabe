// @bessel/propagator: orbit propagation and TLE ingest. Analytic (two-body, J2/J4
// mean-element, SGP4) plus a Cowell numerical propagator (adaptive DOPRI5 + pluggable
// force model). Core layer: depends only on @bessel/spice (reuses prop2b/conics for
// the Kepler math) and the @bessel/pal interface. (STK_PARITY_SPEC §4.1/§4.2.)

export { parseTle, TleError, type Tle } from './tle.ts';
export { parseOmm, ommToTle, OmmError, type Omm } from './omm.ts';
export { publishOem, type OemLike, type OemImportOptions } from './oem-import.ts';
export { sgp4init, sgp4, type SatRec, type TemeState } from './sgp4.ts';
export {
  secularRatesJ2,
  propagateTwoBody,
  propagateMeanElements,
  publishEphemeris,
  emptyTable,
  type EphemerisTable,
  type ClassicalElements,
  type CentralBody,
  type SecularRates,
  type PublishOptions,
} from './elements.ts';
export { propagateCowell, propagateCowellEx, type CowellOptions, type CowellResult } from './cowell.ts';
export { integrate, type Rhs, type IntegratorOptions } from './integrator.ts';
export { integrateDense, type Solution, type Segment, type DenseOptions, type DenseResult } from './dense.ts';
export { scanSegmentEvents, type EventSpec, type EventHit } from './events.ts';
export { augmentInitialState, makeStmRhs, stmFromState, STM_DIM } from './stm.ts';
export { createForceModel } from './force/model.ts';
export { pointMass } from './force/point-mass.ts';
export { zonalHarmonics, type ZonalBody, type ZonalCoeffs } from './force/zonal.ts';
export {
  sphericalHarmonics,
  fixedRotation,
  SphericalHarmonicsError,
  type SphericalHarmonicsBody,
  type SphericalHarmonicsOptions,
  type RotationAt,
} from './force/spherical-harmonics.ts';
export {
  drag,
  exponentialAtmosphere,
  DragError,
  type DragOptions,
  type DensityModel,
  type ExponentialBand,
  type ExponentialAtmosphereOptions,
} from './force/drag.ts';
export {
  harrisPriesterAtmosphere,
  HARRIS_PRIESTER_MEAN,
  type HarrisPriesterOptions,
  type HarrisPriesterRow,
} from './force/harris-priester.ts';
export {
  jacchiaAtmosphere,
  nightMinExosphericTemp,
  geomagneticDeltaTemp,
  diurnalExosphericTemp,
  exosphericTemperatureAt,
  temperatureAt as jacchiaTemperatureAt,
  type JacchiaDrivers,
  type JacchiaAtmosphereOptions,
} from './force/jacchia.ts';
export {
  srp,
  cylindricalShadow,
  SrpError,
  type SrpOptions,
  type SunPositionAt,
} from './force/srp.ts';
export { thirdBody, sampledPosition, type PositionAt } from './force/third-body.ts';
export { constantThrust, type ConstantThrustOptions } from './force/thrust.ts';
export { IntegrationError, OutOfDomainError, EventError, StmUnsupportedError } from './errors.ts';
export type { ForceModel, ForceTerm, ForceContext, Vector3, Mat3, AccelPartials } from './force/types.ts';

// MCS executor and single-level differential corrector (Astrogator-class mission sequences).
export * from './mcs/index.ts';

// EOP-aware TEME -> J2000 (EME2000/GCRF) transform for SGP4 output, plus precession and
// nutation primitives.
export * from './frames/index.ts';
