// Atmospheric path attenuation for RF links: a simplified ITU-R P.618 rain model and
// a slant-path gaseous term. These return a loss in dB to feed linkBudget's
// otherLossesDb. The k/alpha rain coefficients are frequency/polarization dependent
// (ITU-R P.838); the caller supplies them (a few reference pairs are provided).
// (STK_PARITY_SPEC §4.5.)

/** sin(elevation), floored so a near-horizon slant path stays finite. */
function clampedSinEl(elevationRad: number): number {
  return Math.max(Math.sin(elevationRad), 1e-3);
}

/** ITU-R P.838 specific-attenuation regression coefficients (k, alpha). */
export interface RainCoeffs {
  readonly k: number;
  readonly alpha: number;
}

/** A few reference horizontal-polarization (k, alpha) pairs from ITU-R P.838-3. */
export const RAIN_COEFFS: Readonly<Record<string, RainCoeffs>> = {
  // ~12 GHz (Ku-band downlink), ~20 GHz, ~30 GHz (Ka-band).
  ku12: { k: 0.0188, alpha: 1.217 },
  k20: { k: 0.0751, alpha: 1.099 },
  ka30: { k: 0.187, alpha: 1.021 },
};

export interface RainAttenuationInput {
  /** Rain rate exceeded 0.01% of the time (mm/hr). */
  readonly rainRateMmHr: number;
  readonly coeffs: RainCoeffs;
  /** Elevation angle to the spacecraft (rad). */
  readonly elevationRad: number;
  /** Rain height above sea level (km); default ITU-R 0 C isotherm ~4 km. */
  readonly rainHeightKm?: number;
  /** Station height above sea level (km). */
  readonly stationHeightKm?: number;
}

/**
 * Slant-path rain attenuation (dB), ITU-R P.618 simplified: specific attenuation
 * gamma_R = k * R^alpha (dB/km) over the slant path length through the rain layer,
 * with a horizontal-reduction factor. A first-order model (not the full P.618 cell
 * statistics), adequate for a link-budget margin.
 */
export function rainAttenuationDb(input: RainAttenuationInput): number {
  const { rainRateMmHr: R, coeffs, elevationRad } = input;
  if (R <= 0) return 0;
  const hR = input.rainHeightKm ?? 4;
  const hS = input.stationHeightKm ?? 0;
  const sinEl = clampedSinEl(elevationRad);
  const gammaR = coeffs.k * R ** coeffs.alpha; // dB/km
  const slantKm = Math.max(0, (hR - hS) / sinEl); // path length through the rain layer
  // Horizontal projection and a simple path-reduction factor (P.618 form).
  const lg = slantKm * Math.cos(elevationRad);
  const r001 = 1 / (1 + 0.78 * Math.sqrt((lg * gammaR) / R ** 0.55) - 0.38 * (1 - Math.exp(-2 * lg)));
  return gammaR * slantKm * Math.max(0, Math.min(2.5, r001));
}

/**
 * Gaseous (oxygen + water vapor) slant-path attenuation (dB), scaling a supplied
 * zenith attenuation by the secant of the zenith angle (the 1/sin(elevation) airmass).
 * The zenith value is the caller's ITU-R P.676 figure for the band.
 */
export function gaseousAttenuationDb(zenithLossDb: number, elevationRad: number): number {
  const sinEl = clampedSinEl(elevationRad);
  return zenithLossDb / sinEl;
}

/**
 * Sky-noise temperature increment (K) from a rain (or any absorptive) path,
 * ITU-R P.618 style: an absorbing medium at physical temperature Tm raises the
 * apparent antenna temperature by deltaT = Tm * (1 - 10^(-A/10)), where A is the
 * excess path attenuation (dB) and Tm is the effective medium temperature
 * (default 275 K). At A = 0 there is no increment; as A grows large the increment
 * saturates at Tm (the rain fully fills the antenna with its own thermal noise).
 */
export function rainNoiseTempIncrementK(rainAttenuationDb: number, mediumTempK = 275): number {
  if (rainAttenuationDb <= 0) return 0;
  const transmissivity = 10 ** (-rainAttenuationDb / 10);
  return mediumTempK * (1 - transmissivity);
}
