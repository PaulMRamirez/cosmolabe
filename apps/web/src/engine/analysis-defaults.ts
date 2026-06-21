// Canonical default parameters for the configurable analysis tools, in engine units.
// Single source so the engine's omitted-option fallbacks and the panel's pre-filled form
// values cannot drift. Light module (no heavy @bessel imports) so both the lazy
// analysis-ops chunk and the analysis panel import it without merging chunks.

/** A pointing reference an attitude slew can start from or end at. */
export type SlewPointing = 'nadir' | 'sun';

/** Walker constellation design parameters (shared by the engine op and the panel form). */
export interface ConstellationParams {
  readonly totalSats: number;
  readonly planes: number;
  readonly phasing: number;
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
  readonly pattern: 'delta' | 'star';
}

/** Default downlink radio parameters (engine units: frequency in Hz). */
export const DEFAULT_LINK = { eirpDbW: 90, freqHz: 8.4e9, gOverTDbK: 53, dataRateBps: 14_000 } as const;

/** Default conjunction encounter covariance (per-axis sigma, combined hard-body radius). */
export const DEFAULT_CONJUNCTION = { sigmaKm: 1, radiusKm: 0.1 } as const;

/** Default Walker pattern: the 24/3/1 LEO demo. */
export const DEFAULT_CONSTELLATION: ConstellationParams = {
  totalSats: 24,
  planes: 3,
  phasing: 1,
  inclinationDeg: 53,
  altitudeKm: 700,
  pattern: 'delta',
};

/** Default eigen-axis slew: nadir to Sun at 2 deg/s, 0.5 deg/s^2. */
export const DEFAULT_SLEW = { fromMode: 'nadir', toMode: 'sun', maxRateDeg: 2, maxAccelDeg: 0.5 } as const;
