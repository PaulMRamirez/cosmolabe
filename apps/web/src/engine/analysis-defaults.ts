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

/** The composable access constraint stack the panel assembles and the engine runs. Each
 *  member is an independently toggleable constraint over the same observer/target/span; the
 *  enabled ones are intersected (computeAccess) to form the surviving window. UI/engine units:
 *  range in km, range rate in km/s, the Sun keep-out half-angle in degrees. A facility-bound
 *  az/el mask and a terrain LOS are not part of this spec: they need a ground station and a DEM
 *  (Phase 2), so the panel gates them with a hint rather than fabricating inputs. */
export interface AccessConstraintSpec {
  /** Line-of-sight: the target must not be occulted by the mission center body. */
  readonly losEnabled: boolean;
  /** Range gate: observer-to-target distance within [minKm, maxKm]. */
  readonly rangeEnabled: boolean;
  readonly rangeMinKm: number;
  readonly rangeMaxKm: number;
  /** Range-rate band: observer-to-target range rate within [minKmS, maxKmS]. */
  readonly rangeRateEnabled: boolean;
  readonly rangeRateMinKmS: number;
  readonly rangeRateMaxKmS: number;
  /** Sun-exclusion keep-out: target direction at least this many degrees off the Sun. */
  readonly sunKeepoutEnabled: boolean;
  readonly sunKeepoutDeg: number;
  /** [ux-p2-access] Az/el horizon mask at the ACTIVE ground station: the target must clear the
   *  station's min-elevation floor. UNGATED in Phase 2 (the station registry supplies the facility);
   *  the access op skips it loudly when no station is active rather than fabricating one. */
  readonly azElMaskEnabled: boolean;
}

/** Default access constraint stack: line-of-sight on, the rest off with representative bands
 *  pre-filled so toggling one on is a single click. */
export const DEFAULT_ACCESS_CONSTRAINTS: AccessConstraintSpec = {
  losEnabled: true,
  rangeEnabled: false,
  rangeMinKm: 0,
  rangeMaxKm: 1_000_000,
  rangeRateEnabled: false,
  rangeRateMinKmS: -10,
  rangeRateMaxKmS: 10,
  sunKeepoutEnabled: false,
  sunKeepoutDeg: 30,
  azElMaskEnabled: false,
};

/** A selectable sensor boresight pointing mode for the in-FOV sweep. nadir and sun are
 *  computable from sampled geometry; a target-tracking mode is gated to a later phase
 *  (it needs real attitude/CK wiring), so it is not in this union. */
export type FovPointingMode = 'nadir' | 'sun';

/** [ux-p2-access] The link-budget worksheet configuration the panel form drives and the engine op
 *  rolls up (analysis-UX Phase 2, comms-engineer). UI/engine units: frequency GHz here (converted
 *  to Hz at the op), angles deg, data rate bps. The MODCOD name keys into @bessel/rf MODCOD_TABLE.
 *  This is the single source the worksheet form pre-fills and the op falls back to. */
export interface LinkWorksheetSpec {
  readonly eirpDbW: number;
  readonly freqGHz: number;
  readonly gOverTDbK: number;
  readonly dataRateBps: number;
  /** Receive antenna main-lobe pattern + half-power beamwidth (deg) for the pointing loss. */
  readonly antennaPattern: 'parabolic' | 'gaussian';
  readonly hpbwDeg: number;
  readonly pointingErrorDeg: number;
  /** Transmit/receive polarizations + (linear-linear) misalignment (deg). */
  readonly txPolarization: 'linear' | 'rhcp' | 'lhcp';
  readonly rxPolarization: 'linear' | 'rhcp' | 'lhcp';
  readonly polMisalignDeg: number;
  /** Rain rate exceeded 0.01% of the time (mm/hr); 0 disables the rain terms. */
  readonly rainRateMmHr: number;
  /** Rain-coefficient band key into @bessel/rf RAIN_COEFFS. */
  readonly rainCoeffsKey: 'ku12' | 'k20' | 'ka30';
  /** Zenith gaseous (oxygen + water vapor) attenuation (dB), scaled by airmass at the elevation. */
  readonly gaseousZenithDb: number;
  /** The selected MODCOD name (keys into @bessel/rf MODCOD_TABLE), setting required Eb/N0. */
  readonly modcodName: string;
}

/** Default link-worksheet spec: a representative Ka-band downlink with a small pointing error and
 *  the CCSDS convolutional r=1/2 MODCOD; one click toggles the rain terms on. */
export const DEFAULT_LINK_WORKSHEET: LinkWorksheetSpec = {
  eirpDbW: 65,
  freqGHz: 26,
  gOverTDbK: 30,
  dataRateBps: 1_000_000,
  antennaPattern: 'parabolic',
  hpbwDeg: 0.5,
  pointingErrorDeg: 0.1,
  txPolarization: 'rhcp',
  rxPolarization: 'rhcp',
  polMisalignDeg: 0,
  rainRateMmHr: 0,
  rainCoeffsKey: 'ka30',
  gaseousZenithDb: 0.3,
  modcodName: 'ccsds-conv-r1_2',
};

/** [ux-p2-access] The slew-feasibility pointing mode + dynamics the panel form drives. Target-track
 *  points the sensor at the observation target (the nadir/body-center attitude in this phase);
 *  inertial holds a fixed J2000 attitude, so the slew angle is zero (a check that staring inertially
 *  needs no slew). The decision is the eigen-axis duration under the rate/accel vs the inter-pass gap. */
export interface SlewFeasibilitySpec {
  readonly mode: 'targetTrack' | 'inertial';
  readonly maxRateDegPerSec: number;
  readonly maxAccelDegPerSec2: number;
}

/** Default slew dynamics: a 1 deg/s rate, 0.25 deg/s^2 acceleration, target-tracking mode. */
export const DEFAULT_SLEW_FEASIBILITY: SlewFeasibilitySpec = {
  mode: 'targetTrack',
  maxRateDegPerSec: 1,
  maxAccelDegPerSec2: 0.25,
};
