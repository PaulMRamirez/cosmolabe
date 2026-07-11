// Higher-order modulation bit error rate, a small CCSDS/uncoded modcod table, and
// the link-margin roll-up against a required Eb/N0. Closed-form BER approximations
// over the existing erfc; M must be a power of two. Pure, no SPICE.
// (STK_PARITY_SPEC §4.5.)

import { erfc } from './index.ts';
import { ModulationError } from './errors.ts';

const lin = (dbValue: number): number => 10 ** (dbValue / 10);

/** Throw a typed, located error unless M is a power of two with log2(M) >= 2. */
function bitsPerSymbol(m: number): number {
  if (!Number.isInteger(m) || m < 4 || (m & (m - 1)) !== 0) {
    throw new ModulationError(
      `modulation order M must be a power of two with log2(M) >= 2, got M=${m}`,
    );
  }
  return Math.log2(m);
}

/** Q(x) = 0.5 * erfc(x / sqrt(2)), the Gaussian tail used by the QAM model. */
function qFunc(x: number): number {
  return 0.5 * erfc(x / Math.SQRT2);
}

/**
 * M-PSK bit error rate (approx) as a function of Eb/N0 (dB), Gray-coded:
 * BER ~= (1 / log2 M) * erfc( sqrt(log2 M * Eb/N0) * sin(pi/M) ).
 * For M = 2 this reduces exactly to 0.5*erfc(sqrt(Eb/N0)) = berBpsk, because
 * log2(2)=1 and sin(pi/2)=1. M must be a power of two, m >= 2 (i.e. M >= 4 here,
 * with M=2 handled by the BPSK identity below).
 */
export function berMpsk(m: number, ebN0Db: number): number {
  if (m === 2) {
    // BPSK special case: identical to berBpsk, kept here so callers can pass M=2.
    return 0.5 * erfc(Math.sqrt(lin(ebN0Db)));
  }
  const k = bitsPerSymbol(m);
  const ebN0 = lin(ebN0Db);
  const arg = Math.sqrt(k * ebN0) * Math.sin(Math.PI / m);
  return (1 / k) * erfc(arg);
}

/**
 * Square M-QAM bit error rate (approx) as a function of Eb/N0 (dB), Gray-coded:
 * BER ~= (4/k) * (1 - 1/sqrt(M)) * Q( sqrt( 3 k / (M - 1) * Eb/N0 ) ),
 * where k = log2 M and Q is the Gaussian tail. Standard for square 16/64/256-QAM.
 * M must be a power of two with an even number of bits (square constellation).
 */
export function berMqam(m: number, ebN0Db: number): number {
  const k = bitsPerSymbol(m);
  if (k % 2 !== 0) {
    throw new ModulationError(
      `M-QAM requires a square constellation (even log2 M), got M=${m} (log2 M = ${k})`,
    );
  }
  const ebN0 = lin(ebN0Db);
  const sqrtM = Math.sqrt(m);
  const arg = Math.sqrt((3 * k * ebN0) / (m - 1));
  return ((4 / k) * (1 - 1 / sqrtM)) * qFunc(arg);
}

/** A modulation/coding scheme entry and its Eb/N0 requirement at BER = 1e-5. */
export interface ModCod {
  readonly name: string;
  readonly modulation: string;
  /** Code rate (information bits / channel bits); 1 for uncoded. */
  readonly codeRate: number;
  /** Required Eb/N0 (dB) to reach a 1e-5 bit error rate. */
  readonly requiredEbN0Db: number;
}

/**
 * A small reference modcod table. Uncoded entries are the textbook closed-form
 * thresholds at BER = 1e-5; the coded entries are representative CCSDS published
 * thresholds (131.0-B convolutional/Reed-Solomon family), used for link margin.
 */
export const MODCOD_TABLE: readonly ModCod[] = [
  { name: 'uncoded-bpsk', modulation: 'BPSK', codeRate: 1, requiredEbN0Db: 9.6 },
  { name: 'uncoded-qpsk', modulation: 'QPSK', codeRate: 1, requiredEbN0Db: 9.6 },
  { name: 'uncoded-16qam', modulation: '16QAM', codeRate: 1, requiredEbN0Db: 13.4 },
  // CCSDS convolutional r=1/2, K=7 (Viterbi), approx 4.4 dB at 1e-5.
  { name: 'ccsds-conv-r1_2', modulation: 'BPSK', codeRate: 0.5, requiredEbN0Db: 4.4 },
  // CCSDS concatenated convolutional + Reed-Solomon (255,223), approx 2.5 dB.
  { name: 'ccsds-conv-rs', modulation: 'BPSK', codeRate: 0.437, requiredEbN0Db: 2.5 },
];

/** Link margin (dB): achieved Eb/N0 minus the modcod's required Eb/N0. */
export function linkMarginDb(ebN0AchievedDb: number, requiredEbN0Db: number): number {
  return ebN0AchievedDb - requiredEbN0Db;
}
