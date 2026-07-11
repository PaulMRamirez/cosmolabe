# @bessel/rf

Communications link-budget physics: pure, unit-checked, frame-agnostic radio math (no SPICE, no DOM). The analysis layer supplies geometry (range, range-rate); this package supplies free-space path loss, antenna gain, modulation BER, link-budget roll-up, Doppler, and atmospheric attenuation. (STK_PARITY_SPEC §4.5.)

## Public API

Constants and helpers: `C_KM_S`, `BOLTZMANN_DB`, `erf`, `erfc`, `wavelengthM`.

Link physics:
- `friisPathLossDb(distanceKm, freqHz)`, `dopplerShiftHz(freqHz, rangeRateKmS)` (negative when the range is opening).
- `parabolicGainDbi(diameterM, freqHz, efficiency?)`, `halfPowerBeamwidthDeg(diameterM, freqHz)`.
- `berBpsk(ebN0Db)` and `berQpsk` (identical vs Eb/N0).
- `linkBudget(input: LinkBudgetInput): LinkBudget` rolls up C/N0, Eb/N0, and margin.

Comm entities (`comm-entities.ts`): `dishAntenna`, `eirpDbW`, `gOverTDbK` with `Antenna`, `Transmitter`, `Receiver` types.

Atmosphere (`atmosphere.ts`): `rainAttenuationDb`, `gaseousAttenuationDb`, `RAIN_COEFFS` (reference k/alpha pairs), with `RainCoeffs` and `RainAttenuationInput` types.

```ts
import { linkBudget } from '@bessel/rf';
const b = linkBudget({
  eirpDbW: 50, distanceKm: 40000, freqHz: 8e9,
  gOverTDbK: 30, dataRateBps: 1e6, otherLossesDb: 2, requiredEbN0Db: 4.4,
});
// b.cN0DbHz, b.ebN0Db, b.marginDb
```

## Dependency rule

Depends on: nothing (pure; no `@bessel` dependencies). Part of the core layer: a self-contained analysis engine with no SPICE, PAL, UI, or DOM imports, so lower layers never reach upward.

## Tests

Tests live in `packages/rf/src/rf.test.ts` and `packages/rf/src/atmosphere.test.ts`. They validate against closed-form references: hand-computed Friis loss (~190.5 dB at 2 GHz over 40000 km), parabolic gain `eta*(pi*D/lambda)^2`, the textbook BPSK ~1e-5 BER at 9.6 dB Eb/N0, C/N0 composition, and Doppler sign; `erfc` is checked against known values.

## Algorithm and references

- Path loss and link budget: Friis free-space equation with the C/N0 = EIRP - Lfs - Lother + G/T - k(dB) roll-up; DSN Telecommunications Link Design Handbook (JPL 810-005) conventions.
- BER: closed-form BPSK/QPSK `0.5*erfc(sqrt(Eb/N0))`, with the Abramowitz-Stegun 7.1.26 erf approximation (|err| < 1.5e-7).
- Atmosphere: simplified ITU-R P.618 slant-path rain model with P.838 specific-attenuation k/alpha coefficients, and a secant-scaled P.676 gaseous term.

See REFERENCES.md (Communications and RF link budgets: ITU-R P.618/P.676/P.838; JPL 810-005).

## Status / limitations

First-order models adequate for link-budget margins, not full statistics: the rain model is not the complete P.618 cell statistics, and the gaseous term scales a caller-supplied zenith loss by airmass. The caller supplies geometry and band-specific coefficients; only BPSK/QPSK BER is modeled.
