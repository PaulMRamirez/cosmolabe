// Typed communications entities (antenna, transmitter, receiver) and the rolled-up
// figures a link budget consumes: EIRP from a transmitter and G/T from a receiver. A
// comm-entity schema so link analysis is configured from named hardware rather than
// loose numbers. (STK_PARITY_SPEC §4.5.)

import { parabolicGainDbi } from './index.ts';

export interface Antenna {
  /** Peak gain (dBi). */
  readonly gainDbi: number;
}

/** Build an antenna from a parabolic dish (diameter m, frequency Hz, efficiency). */
export function dishAntenna(diameterM: number, freqHz: number, efficiency = 0.55): Antenna {
  return { gainDbi: parabolicGainDbi(diameterM, freqHz, efficiency) };
}

export interface Transmitter {
  /** Transmitter output power (dBW). */
  readonly powerDbW: number;
  readonly antenna: Antenna;
  /** Feed/line loss between the amplifier and the antenna (dB). */
  readonly lineLossDb?: number;
}

export interface Receiver {
  readonly antenna: Antenna;
  /** System noise temperature referred to the antenna terminals (K). */
  readonly systemNoiseTempK: number;
  /** Feed/line loss ahead of the LNA (dB). */
  readonly lineLossDb?: number;
}

/** Effective isotropic radiated power (dBW): power + antenna gain - line loss. */
export function eirpDbW(tx: Transmitter): number {
  return tx.powerDbW + tx.antenna.gainDbi - (tx.lineLossDb ?? 0);
}

/** Receiver figure of merit G/T (dB/K): gain - line loss - 10 log10(T_sys). */
export function gOverTDbK(rx: Receiver): number {
  return rx.antenna.gainDbi - (rx.lineLossDb ?? 0) - 10 * Math.log10(rx.systemNoiseTempK);
}
