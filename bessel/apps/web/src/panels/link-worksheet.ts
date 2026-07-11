// The itemized link-budget WORKSHEET assembly (analysis-UX Phase 2, comms-engineer journey). A
// PURE function over the @bessel/rf builders: given the link configuration (radio + atmosphere +
// modcod) and a single pass geometry point (range + elevation), it rolls up the line-by-line budget
// (EIRP, free-space loss, antenna/pointing loss, polarization, rain attenuation + rain noise temp,
// gaseous, G/T, C/N0, Eb/N0, required-Eb/N0 from the selected MODCOD, MARGIN). No SPICE, no DOM, no
// Math.random/Date.now, so the assembly is unit-tested directly against the rf builders. The engine
// op supplies the worst-case and nominal elevation geometry of the selected station pass and the
// margin-vs-time series; this module owns the physics roll-up and the table shape.

import {
  friisPathLossDb,
  pointingLossDb,
  polarizationLossDb,
  rainAttenuationDb,
  rainNoiseTempIncrementK,
  gaseousAttenuationDb,
  linkBudget,
  RAIN_COEFFS,
  type AntennaPattern,
  type Polarization,
  type RainCoeffs,
} from '@bessel/rf';

/** A located, typed error for a worksheet the assembly cannot build (fail loudly). */
export class LinkWorksheetError extends Error {
  override readonly name = 'LinkWorksheetError';
  constructor(message: string) {
    super(`link-worksheet: ${message}`);
  }
}

/** The downlink-radio + atmosphere + modcod configuration the worksheet rolls up. Engine units
 *  (frequency Hz, data rate bps, angles deg), so it is one source the panel form and op share. */
export interface LinkWorksheetConfig {
  /** Effective isotropic radiated power of the transmitter (dBW). */
  readonly eirpDbW: number;
  /** Carrier frequency (Hz). */
  readonly freqHz: number;
  /** Receiver figure of merit G/T (dB/K) at zero sky-noise increment (clear-sky). */
  readonly gOverTDbK: number;
  /** Information data rate (bps). */
  readonly dataRateBps: number;
  /** Receive antenna main-lobe pattern + half-power beamwidth (deg) for the pointing loss. */
  readonly antennaPattern: AntennaPattern;
  readonly hpbwDeg: number;
  /** Antenna mispointing off the line of sight (deg). */
  readonly pointingErrorDeg: number;
  /** Transmit and receive polarizations + (linear-linear only) misalignment (deg). */
  readonly txPolarization: Polarization;
  readonly rxPolarization: Polarization;
  readonly polMisalignDeg: number;
  /** Rain rate exceeded 0.01% of the time (mm/hr); 0 disables the rain terms. */
  readonly rainRateMmHr: number;
  /** Rain k/alpha key into RAIN_COEFFS (the band's specific-attenuation regression). */
  readonly rainCoeffsKey: keyof typeof RAIN_COEFFS;
  /** Zenith gaseous (oxygen + water vapor) attenuation (dB) scaled by airmass. */
  readonly gaseousZenithDb: number;
  /** The selected MODCOD's required Eb/N0 (dB) at the target BER; the margin is vs this. */
  readonly requiredEbN0Db: number;
}

/** One geometry sample of the pass the worksheet is computed at: slant range + elevation. */
export interface PassGeometry {
  readonly rangeKm: number;
  readonly elevationRad: number;
}

/** One itemized worksheet line: a labelled contribution to the budget, in dB (or dB/K, dB-Hz). */
export interface WorksheetLine {
  /** A stable id for the row (testid + CSV key), e.g. 'free-space-loss'. */
  readonly id: string;
  readonly label: string;
  /** The value in the line's unit (dB unless the unit field says otherwise). */
  readonly value: number;
  readonly unit: string;
}

/** The assembled worksheet at one geometry point: the itemized lines plus the rolled-up figures. */
export interface LinkWorksheet {
  readonly lines: readonly WorksheetLine[];
  /** Carrier-to-noise-density (dB-Hz). */
  readonly cN0DbHz: number;
  readonly ebN0Db: number;
  readonly requiredEbN0Db: number;
  /** Margin (dB) = achieved Eb/N0 - required Eb/N0; positive closes the link. */
  readonly marginDb: number;
  /** The G/T degraded by the rain sky-noise increment (dB/K), the figure the budget used. */
  readonly effectiveGOverTDbK: number;
  /** The geometry the worksheet was computed at, echoed for the readout. */
  readonly geometry: PassGeometry;
}

/** Resolve the rain coefficients for the config's band key, failing loud on an unknown key. */
function resolveRainCoeffs(key: keyof typeof RAIN_COEFFS): RainCoeffs {
  const coeffs = RAIN_COEFFS[key];
  if (!coeffs) {
    throw new LinkWorksheetError(`unknown rain-coefficient band "${String(key)}"`);
  }
  return coeffs;
}

/**
 * Assemble the itemized link budget at one pass geometry point. The pointing loss comes from the
 * receive antenna pattern at the mispointing angle; the polarization loss from the tx/rx senses; the
 * rain attenuation from the ITU-R P.618 slant path at the pass elevation, with its sky-noise
 * increment degrading G/T (deltaT raises the system temperature, lowering G/T by 10log10(T'/T)); the
 * gaseous term scales the zenith value by airmass. The losses sum into linkBudget's otherLossesDb,
 * and the modcod's required Eb/N0 sets the margin. Fails loud on a non-physical geometry.
 */
export function assembleLinkWorksheet(config: LinkWorksheetConfig, geometry: PassGeometry): LinkWorksheet {
  if (!(geometry.rangeKm > 0)) {
    throw new LinkWorksheetError(`range must be positive km, got ${geometry.rangeKm}`);
  }
  if (!Number.isFinite(geometry.elevationRad)) {
    throw new LinkWorksheetError(`elevation must be a finite radian, got ${geometry.elevationRad}`);
  }

  const freeSpaceLossDb = friisPathLossDb(geometry.rangeKm, config.freqHz);
  // Pointing/polarization losses are non-positive; their magnitudes ADD to the link's other losses.
  const pointingDb = pointingLossDb(config.antennaPattern, config.hpbwDeg, config.pointingErrorDeg);
  const polarizationDb = polarizationLossDb(config.txPolarization, config.rxPolarization, config.polMisalignDeg);
  const rainDb =
    config.rainRateMmHr > 0
      ? rainAttenuationDb({
          rainRateMmHr: config.rainRateMmHr,
          coeffs: resolveRainCoeffs(config.rainCoeffsKey),
          elevationRad: geometry.elevationRad,
        })
      : 0;
  const gaseousDb = gaseousAttenuationDb(config.gaseousZenithDb, geometry.elevationRad);
  // Rain raises the apparent antenna temperature; G/T degrades by the ratio of the noise temps. We
  // reference the increment to a representative clear-sky system temperature so the budget reflects
  // the noise penalty, not just the signal attenuation.
  const rainNoiseK = rainNoiseTempIncrementK(rainDb);
  const baselineTsysK = 150; // representative receive-system noise temperature (K) for the G/T penalty
  const gOverTPenaltyDb = rainNoiseK > 0 ? 10 * Math.log10((baselineTsysK + rainNoiseK) / baselineTsysK) : 0;
  const effectiveGOverTDbK = config.gOverTDbK - gOverTPenaltyDb;

  // The "other losses" the link equation subtracts: the magnitudes of every loss term (each is
  // returned non-positive for the pattern/polarization terms, positive-dB for the atmospheric terms).
  const otherLossesDb = -pointingDb - polarizationDb + rainDb + gaseousDb;
  const budget = linkBudget({
    eirpDbW: config.eirpDbW,
    distanceKm: geometry.rangeKm,
    freqHz: config.freqHz,
    gOverTDbK: effectiveGOverTDbK,
    dataRateBps: config.dataRateBps,
    otherLossesDb,
    requiredEbN0Db: config.requiredEbN0Db,
  });

  const lines: WorksheetLine[] = [
    { id: 'eirp', label: 'EIRP', value: config.eirpDbW, unit: 'dBW' },
    { id: 'free-space-loss', label: 'Free-space loss', value: -freeSpaceLossDb, unit: 'dB' },
    { id: 'pointing-loss', label: 'Antenna/pointing loss', value: pointingDb, unit: 'dB' },
    { id: 'polarization-loss', label: 'Polarization mismatch', value: polarizationDb, unit: 'dB' },
    { id: 'rain-attenuation', label: 'Rain attenuation', value: -rainDb, unit: 'dB' },
    { id: 'rain-noise-temp', label: 'Rain noise-temp increment', value: rainNoiseK, unit: 'K' },
    { id: 'gaseous-attenuation', label: 'Gaseous attenuation', value: -gaseousDb, unit: 'dB' },
    { id: 'g-over-t', label: 'G/T (rain-degraded)', value: effectiveGOverTDbK, unit: 'dB/K' },
    { id: 'c-over-n0', label: 'C/N0', value: budget.cN0DbHz, unit: 'dB-Hz' },
    { id: 'eb-over-n0', label: 'Eb/N0 (achieved)', value: budget.ebN0Db, unit: 'dB' },
    { id: 'required-eb-over-n0', label: 'Required Eb/N0 (MODCOD)', value: config.requiredEbN0Db, unit: 'dB' },
    { id: 'margin', label: 'Margin', value: budget.marginDb ?? Number.NaN, unit: 'dB' },
  ];

  return {
    lines,
    cN0DbHz: budget.cN0DbHz,
    ebN0Db: budget.ebN0Db,
    requiredEbN0Db: config.requiredEbN0Db,
    marginDb: budget.marginDb ?? Number.NaN,
    effectiveGOverTDbK,
    geometry,
  };
}

/** Build the worksheet CSV rows (one per line item) for the unified exporter's table kind. */
export function worksheetCsvRows(worksheet: LinkWorksheet): readonly (readonly (string | number)[])[] {
  return worksheet.lines.map((l) => [l.label, l.value, l.unit] as const);
}
