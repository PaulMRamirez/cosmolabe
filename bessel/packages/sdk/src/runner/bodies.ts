// Default gravitational parameters and body radii (SPICE PCK/SPK carry GM but not a
// convenient typed map for the MCS environment). The host can override per job. Values
// from DE440 / IAU. (STK_PARITY_SPEC, SDK.)

import type { BodyDynamics } from '@bessel/propagator';

export const BODY_GM: ReadonlyMap<number, BodyDynamics> = new Map<number, BodyDynamics>([
  [399, { gm: 398600.4418, bodyRadius: 6378.137 }], // Earth
  [10, { gm: 132712440018, bodyRadius: 695700 }], // Sun
  [301, { gm: 4902.800066, bodyRadius: 1737.4 }], // Moon
  [499, { gm: 42828.375214, bodyRadius: 3396.19 }], // Mars
]);
