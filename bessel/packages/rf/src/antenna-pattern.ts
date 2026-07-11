// Off-axis antenna pattern, pointing loss, and polarization mismatch loss: the
// pattern math that turns a peak antenna gain into the realized gain once the
// boresight is mispointed and the polarizations are misaligned. All losses are
// returned as non-positive dB relative to the matched/boresight case, ready to
// add into linkBudget's otherLossesDb. Pure, no SPICE. (STK_PARITY_SPEC §4.5.)

/**
 * Deep-null floor (dB) for the main-lobe approximations below. The simple
 * quadratic main-lobe models are only valid near boresight; beyond a few
 * beamwidths they would diverge to absurd negatives, so we clamp to a sane
 * deep null. -60 dB is well below any realistic main-lobe operating point.
 */
export const PATTERN_NULL_FLOOR_DB = -60;

/** Off-axis main-lobe gain models keyed to the half-power beamwidth (HPBW). */
export type AntennaPattern = 'parabolic' | 'gaussian';

/**
 * Off-axis gain reduction (dB, <= 0) relative to the boresight peak, for a
 * main-lobe pattern with the given half-power beamwidth (HPBW, deg) evaluated at
 * an off-boresight angle (deg).
 *
 * - 'parabolic': the IEEE Std 149 main-lobe approximation
 *   lossDb = -12 * (off / HPBW)^2, which is -3.0 dB at off = HPBW/2 (half power).
 * - 'gaussian': the standard Gaussian main lobe G(theta) = exp(-4 ln2 (off/HPBW)^2),
 *   normalized so G = 1/2 at off = HPBW/2 (the half-power definition). In dB this is
 *   lossDb = -(40 ln2 / ln10) * (off/HPBW)^2 = -12.041 * (off/HPBW)^2, exactly
 *   -3.0103 dB at off = HPBW/2. The same -12 (off/HPBW)^2 leading term as the
 *   parabolic model, differing only in the third figure.
 *
 * Both are clamped to PATTERN_NULL_FLOOR_DB so a wildly mispointed antenna does
 * not return a divergent value; the models are only physical inside the main lobe.
 */
const GAUSSIAN_DB_COEFF = (40 * Math.LN2) / Math.LN10; // 12.0412, gives -3.0103 at HPBW/2

export function antennaPatternLossDb(
  pattern: AntennaPattern,
  hpbwDeg: number,
  offBoresightDeg: number,
): number {
  if (!(hpbwDeg > 0)) {
    throw new RangeError(`antennaPatternLossDb: hpbwDeg must be > 0, got ${hpbwDeg}`);
  }
  const ratio = Math.abs(offBoresightDeg) / hpbwDeg;
  const coeff = pattern === 'gaussian' ? GAUSSIAN_DB_COEFF : 12;
  const lossDb = -coeff * ratio * ratio;
  return Math.max(lossDb, PATTERN_NULL_FLOOR_DB);
}

/**
 * Pointing (mispointing) loss (dB, <= 0): a thin alias for antennaPatternLossDb,
 * named for the link-budget term it feeds. The "loss" from a transmit or receive
 * antenna whose boresight is off the line of sight by offBoresightDeg.
 */
export function pointingLossDb(
  pattern: AntennaPattern,
  hpbwDeg: number,
  offBoresightDeg: number,
): number {
  return antennaPatternLossDb(pattern, hpbwDeg, offBoresightDeg);
}

/** Antenna polarizations supported by the mismatch model. */
export type Polarization = 'linear' | 'rhcp' | 'lhcp';

/**
 * Cross-polar isolation floor (dB) for the worst case, opposite-sense circular
 * (e.g. RHCP transmit into an LHCP receive). Theory gives -infinity; real
 * antennas have finite axial ratio, so we clamp to a deep but finite loss.
 */
export const POLARIZATION_NULL_FLOOR_DB = -60;

/** -3.0103 dB: the loss when coupling a linear field into a circular antenna (or
 *  vice versa), where only half the power is captured (10*log10(0.5)). */
const CIRCULAR_FROM_LINEAR_DB = 10 * Math.log10(0.5);

/**
 * Polarization mismatch loss (dB, <= 0) between a transmit and a receive antenna.
 *
 * - linear -> linear, aligned (misalignDeg = 0): 0 dB.
 * - linear -> linear, misaligned by theta deg: -10*log10(cos(theta)^2), i.e.
 *   -6.02 dB at 60 deg, -infinity at 90 deg (clamped to the null floor).
 * - linear <-> circular (either sense): -3.0103 dB (half the power couples).
 * - circular, same sense (rhcp->rhcp, lhcp->lhcp): 0 dB.
 * - circular, opposite sense (rhcp<->lhcp): the cross-polar null, clamped to
 *   POLARIZATION_NULL_FLOOR_DB.
 *
 * misalignDeg applies only to the linear -> linear case; it is ignored otherwise.
 */
export function polarizationLossDb(
  tx: Polarization,
  rx: Polarization,
  misalignDeg = 0,
): number {
  const txCircular = tx === 'rhcp' || tx === 'lhcp';
  const rxCircular = rx === 'rhcp' || rx === 'lhcp';

  if (!txCircular && !rxCircular) {
    // linear -> linear: cos^2 of the misalignment angle.
    const theta = (misalignDeg * Math.PI) / 180;
    const cos2 = Math.cos(theta) ** 2;
    if (cos2 <= 0) return POLARIZATION_NULL_FLOOR_DB;
    return Math.max(10 * Math.log10(cos2), POLARIZATION_NULL_FLOOR_DB);
  }

  if (txCircular && rxCircular) {
    // Circular to circular: matched senses pass, opposite senses null out.
    return tx === rx ? 0 : POLARIZATION_NULL_FLOOR_DB;
  }

  // Mixed linear/circular: half the power couples regardless of orientation.
  return CIRCULAR_FROM_LINEAR_DB;
}
