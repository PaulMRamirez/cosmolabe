// @bessel/od: orbit determination. A Gauss-Newton batch least-squares estimator and a
// sequential extended Kalman filter, both seeded by the State Transition Matrix the
// Cowell propagator co-integrates (variational equations). Analytic measurement models
// for range, range-rate, and angles (right ascension/declination or azimuth/elevation).
// Core layer: depends only on @bessel/propagator and @bessel/spice. (STK-class OD;
// Vallado §10, Tapley-Schutz-Born.)

export {
  type OdState,
  type Covariance6,
  type ObserverPosition,
  type Measurement,
  type RangeMeasurement,
  type RangeRateMeasurement,
  type AnglesMeasurement,
  measurementSize,
} from './types.ts';

export { predict, residual, noiseVariances, wrapPi, type Prediction } from './measurements.ts';

export {
  bennettRefraction,
  bennettRefractionSlope,
  type RefractionConditions,
} from './refraction.ts';

export {
  predictLightTime,
  SPEED_OF_LIGHT_KM_S,
  type LightTimeOptions,
  type LightTimePrediction,
} from './light-time.ts';

export {
  considerCovariance,
  type ConsiderBlocks,
  type ConsiderSensitivity,
} from './consider.ts';

export { batchLeastSquares, type BatchOptions, type BatchResult, type ConsiderConfig } from './batch-ls.ts';

export { ExtendedKalmanFilter, type EkfOptions, type EkfStep } from './ekf.ts';

export { propagateArc, type Arc } from './propagate.ts';

export {
  type Mat,
  mat,
  identity,
  matmul,
  transpose,
  add,
  sub,
  matVec,
  symmetrize,
  cholesky,
  cholSolve,
  symInverse,
  gaussSolve,
  isPositiveDefinite,
} from './linalg.ts';

export { OdError, SingularMatrixError, ConvergenceError, MeasurementError } from './errors.ts';
