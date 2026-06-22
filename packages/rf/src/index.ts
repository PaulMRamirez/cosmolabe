// @bessel/rf: communications link-budget physics. Pure, unit-checked, frame-
// agnostic functions (no SPICE, no DOM): free-space path loss, antenna gain
// patterns, modulation BER, link-budget roll-up, and Doppler. The analysis layer
// supplies geometry (range, range-rate); this package supplies the radio math.
// (STK_PARITY_SPEC §4.5.)

/** Speed of light (km/s) and (m/s). */
export const C_KM_S = 299792.458;
const C_M_S = 299_792_458;
/** -10*log10(Boltzmann constant): the link-equation noise constant (dB). */
export const BOLTZMANN_DB = -10 * Math.log10(1.380649e-23); // ~228.599

/** Abramowitz-Stegun 7.1.26 error function (|err| < 1.5e-7), and its complement. */
export function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const y = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? y : -y;
}
export function erfc(x: number): number {
  return 1 - erf(x);
}

const dB = (linear: number): number => 10 * Math.log10(linear);
const lin = (dbValue: number): number => 10 ** (dbValue / 10);

/** Wavelength (m) for a frequency (Hz). */
export function wavelengthM(freqHz: number): number {
  return C_M_S / freqHz;
}

/** Free-space (Friis) path loss in dB for distance (km) at frequency (Hz). */
export function friisPathLossDb(distanceKm: number, freqHz: number): number {
  const lambda = wavelengthM(freqHz);
  return 20 * Math.log10((4 * Math.PI * distanceKm * 1000) / lambda);
}

/** Peak gain (dBi) of a parabolic dish: diameter (m), frequency (Hz), efficiency. */
export function parabolicGainDbi(diameterM: number, freqHz: number, efficiency = 0.55): number {
  const lambda = wavelengthM(freqHz);
  return dB(efficiency * (Math.PI * diameterM / lambda) ** 2);
}

/** Half-power beamwidth (deg) of a parabolic dish (the ~70 lambda/D rule). */
export function halfPowerBeamwidthDeg(diameterM: number, freqHz: number): number {
  return (70 * wavelengthM(freqHz)) / diameterM;
}

/** BPSK (and QPSK) theoretical bit error rate as a function of Eb/N0 (dB). */
export function berBpsk(ebN0Db: number): number {
  return 0.5 * erfc(Math.sqrt(lin(ebN0Db)));
}
export const berQpsk = berBpsk; // identical BER vs Eb/N0

export interface LinkBudgetInput {
  readonly eirpDbW: number;
  readonly distanceKm: number;
  readonly freqHz: number;
  /** Receiver figure of merit G/T (dB/K). */
  readonly gOverTDbK: number;
  readonly dataRateBps: number;
  /** Other losses (atmospheric, pointing, polarization, implementation) in dB. */
  readonly otherLossesDb?: number;
  /** Required Eb/N0 for the modulation/coding (dB); margin is computed against it. */
  readonly requiredEbN0Db?: number;
}

export interface LinkBudget {
  readonly pathLossDb: number;
  /** Carrier-to-noise-density ratio (dB-Hz). */
  readonly cN0DbHz: number;
  readonly ebN0Db: number;
  /** Link margin vs the required Eb/N0 (dB); null when no requirement was given. */
  readonly marginDb: number | null;
}

/** Roll up a one-way link budget: C/N0 = EIRP - Lfs - Lother + G/T - k(dB). */
export function linkBudget(input: LinkBudgetInput): LinkBudget {
  const pathLossDb = friisPathLossDb(input.distanceKm, input.freqHz);
  const cN0DbHz =
    input.eirpDbW - pathLossDb - (input.otherLossesDb ?? 0) + input.gOverTDbK + BOLTZMANN_DB;
  const ebN0Db = cN0DbHz - 10 * Math.log10(input.dataRateBps);
  return {
    pathLossDb,
    cN0DbHz,
    ebN0Db,
    marginDb: input.requiredEbN0Db === undefined ? null : ebN0Db - input.requiredEbN0Db,
  };
}

/** Doppler shift (Hz) for a carrier (Hz) and range rate (km/s; positive = opening). */
export function dopplerShiftHz(freqHz: number, rangeRateKmS: number): number {
  return -freqHz * (rangeRateKmS / C_KM_S);
}

export {
  rainAttenuationDb,
  gaseousAttenuationDb,
  rainNoiseTempIncrementK,
  RAIN_COEFFS,
  type RainCoeffs,
  type RainAttenuationInput,
} from './atmosphere.ts';
export {
  dishAntenna,
  eirpDbW,
  gOverTDbK,
  type Antenna,
  type Transmitter,
  type Receiver,
} from './comm-entities.ts';
export {
  antennaPatternLossDb,
  pointingLossDb,
  polarizationLossDb,
  PATTERN_NULL_FLOOR_DB,
  POLARIZATION_NULL_FLOOR_DB,
  type AntennaPattern,
  type Polarization,
} from './antenna-pattern.ts';
export {
  berMpsk,
  berMqam,
  linkMarginDb,
  MODCOD_TABLE,
  type ModCod,
} from './modulation.ts';
export { RfError, ModulationError } from './errors.ts';
