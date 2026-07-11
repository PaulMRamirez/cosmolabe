# @bessel/conjunction

Close-approach math for conjunction assessment: time of closest approach (TCA) and miss distance for rectilinear relative motion, plus the 2D probability of collision (Pc) in the encounter plane. Pure functions with no dependencies; the screening and propagation pipeline layers on top. Part of the core analysis-engine layer.

## Public API

Types: `Vec3`, `ClosestApproach` (tca, missKm, relSpeedKmS), `PcInput` (combined hard-body radius, encounter-plane 1-sigma sigmas, projected miss vector).

Functions:

- `closestApproachLinear(relPos, relVel)`: closest approach for rectilinear relative motion (target minus chaser), where the range rate is zero. Returns the `ClosestApproach`.
- `collisionProbability2D(input, samples?)`: probability of collision in the 2D encounter plane via Foster's method. Integrates an axis-aligned bivariate Gaussian over the combined hard-body disk by polar (midpoint) quadrature.
- `screenAllVsAll(objects, opts)`: all-vs-all close-approach screening. Given N objects as `SampledEphemeris` (id, shared epoch grid, interleaved positions/velocities, optional radius/sigma), it flags every pair that closes below `opts.thresholdKm` and reports each pair's `ConjunctionEvent` (TCA, miss, relative speed, and Pc when both objects carry a radius and sigma). A two-stage smart sieve (a per-object apogee/perigee radial-shell band, then a coarse conjunction-box per-axis overlap) rejects non-conjuncting pairs before any fine refinement, so the full O(N^2) distance evaluation is avoided for distant pairs. The refinement reuses `closestApproachLinear` (TCA) and `collisionProbability2D` (Pc) in this package. Types: `SampledEphemeris`, `ConjunctionEvent`, `ScreenOptions`; loud `ScreenError` on malformed input.

```ts
import { screenAllVsAll } from '@bessel/conjunction';

const events = screenAllVsAll(
  [primary, ...catalog], // each a SampledEphemeris over the screening grid
  { thresholdKm: 5, sieveMarginKm: 50 },
);
// events: every flagged pair, sorted by TCA, with miss and (when covariance is present) Pc.
```

```ts
import { closestApproachLinear, collisionProbability2D } from '@bessel/conjunction';

const ca = closestApproachLinear({ x: 70, y: 10, z: 0 }, { x: -7, y: 0, z: 0 });
// ca.tca === 10, ca.missKm === 10, ca.relSpeedKmS === 7

const pc = collisionProbability2D({
  radiusKm: 0.02, sigmaXKm: 0.1, sigmaYKm: 0.1, missXKm: 0, missYKm: 0,
});
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer; it imports no other `@bessel` packages and no concrete PAL implementation.

## Tests

Tests live in `packages/conjunction/src/conjunction.test.ts`. TCA and miss are checked against a closed-form crossing geometry; the 2D Pc is validated against the analytic centered-circular solution `Pc = 1 - exp(-R^2 / 2 sigma^2)` to 5 decimal places, with monotonicity checks (Pc falls as the miss grows, rises with the hard-body radius) and a zero result for non-physical inputs.

## Algorithm and references

Pc uses Foster's 2D encounter-plane method (Foster & Estes; NASA CARA Pc methodology), per REFERENCES.md. The conjunction data exchange format referenced by the wider pipeline is CCSDS 508.0-B (Conjunction Data Message).

## Status / limitations

Covariance is assumed axis-aligned in the encounter plane (diagonal, no cross-correlation), and relative motion is treated as rectilinear; there is no off-axis rotation or curved-trajectory handling here. The pure math is engine-only; screening and propagation are out of scope for this package.
