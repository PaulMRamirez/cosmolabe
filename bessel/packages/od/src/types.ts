// The data types of orbit determination: an estimated Cartesian state at an epoch, a
// 6x6 covariance, and a tagged-union Measurement (range, range-rate, angles). Every
// measurement carries the observer's inertial (ECI) position, the epoch, and a noise
// sigma, so the measurement models (measurements.ts) stay pure functions of geometry.
// All quantities are in the propagator's units: km, km/s, seconds, radians.
// (Vallado §10.2; Tapley-Schutz-Born §3-4.)

/** A 6-vector [x, y, z, vx, vy, vz] (km, km/s) in an inertial frame at `epoch` (ET s). */
export interface OdState {
  /** The 6-state, length 6: position (km) then velocity (km/s). */
  readonly x: Float64Array;
  /** ET seconds of the state. */
  readonly epoch: number;
}

/** A row-major 6x6 covariance (or any 6x6), length 36. */
export type Covariance6 = Float64Array;

/** A 3-vector (km), the observer's inertial (ECI) position at the measurement epoch. */
export type ObserverPosition = readonly [number, number, number];

/** Common fields of every measurement: when, from where, and the noise sigma. */
interface MeasurementBase {
  /** ET seconds of the observation. */
  readonly epoch: number;
  /** Observer (station) inertial position (km) at `epoch`, same frame as the state. */
  readonly observer: ObserverPosition;
  /**
   * One-sigma measurement noise. Scalar for range (km) and range-rate (km/s); a pair
   * for angles (rad, rad), one per component, in the order the model returns them.
   */
  readonly sigma: number | readonly [number, number];
}

/** Scalar range |r_target - r_obs| (km). */
export interface RangeMeasurement extends MeasurementBase {
  readonly kind: 'range';
  readonly value: number;
  readonly sigma: number;
}

/** Scalar range-rate d/dt|r_target - r_obs| (km/s). The observer is assumed inertial. */
export interface RangeRateMeasurement extends MeasurementBase {
  readonly kind: 'rangeRate';
  readonly value: number;
  readonly sigma: number;
}

/**
 * A two-component angle pair (rad). `frame: 'radec'` gives topocentric right ascension
 * and declination; `frame: 'azel'` gives azimuth (from North, clockwise) and elevation
 * in a local East-North-Up frame whose axes are supplied per measurement. Both read the
 * line-of-sight unit vector r_target - r_obs.
 */
export interface AnglesMeasurement extends MeasurementBase {
  readonly kind: 'angles';
  readonly frame: 'radec' | 'azel';
  /** [first, second] in radians: [ra, dec] or [az, el]. */
  readonly value: readonly [number, number];
  readonly sigma: readonly [number, number];
  /**
   * For `azel`, the local East/North/Up unit axes (each a 3-vector) at the observer.
   * Required for azel, ignored for radec.
   */
  readonly enu?: { readonly east: readonly [number, number, number]; readonly north: readonly [number, number, number]; readonly up: readonly [number, number, number] };
  /**
   * For `azel`, optionally model tropospheric refraction: the predicted elevation is raised by
   * the Bennett refraction angle R(el) so it matches the APPARENT elevation a station reports.
   * Pass `true` for standard sea-level conditions or an object to set the site pressure (mbar)
   * and temperature (K). Omitted/false leaves the geometric (vacuum) elevation. Ignored for
   * radec and for azimuth (refraction is vertical, it does not bend the azimuth).
   */
  readonly refraction?: boolean | { readonly pressureMbar?: number; readonly temperatureK?: number };
}

/** The measurement union the estimators consume. */
export type Measurement = RangeMeasurement | RangeRateMeasurement | AnglesMeasurement;

/** Number of scalar components a measurement contributes (1 for range/rate, 2 for angles). */
export function measurementSize(m: Measurement): 1 | 2 {
  return m.kind === 'angles' ? 2 : 1;
}
