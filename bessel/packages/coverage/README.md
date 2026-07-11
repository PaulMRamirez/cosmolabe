# @bessel/coverage

Constellation generation and Figure-of-Merit (FOM) reduction for coverage analysis. Pure functions that operate on access windows and orbital element sets; the full ground-grid sweep is composed on top of `@bessel/access`. Part of the core layer.

## Public API

FOM reduction:

- `FigureOfMerit` (interface): `percentCoverage` ([0, 1]), `accessCount`, `meanGapSec`, `maxGapSec`, `timeToFirstSec` (`number | null`).
- `figureOfMerit(window, span)`: reduces one ground point's access `Window` over `[t0, t1]` to a `FigureOfMerit`.

Constellation generation:

- `WalkerParams` (interface): base orbit (`a`, `e`, `i`, `argp`), `totalSats` (T), `planes` (P, must divide T), `phasing` (F), optional `raan0`, `pattern` (`'delta' | 'star'`), `epoch`.
- `walkerConstellation(params)`: returns `ClassicalElements[]` for a Walker Delta (default, RAAN over 2pi) or Star (RAAN over pi) constellation.

```ts
import { figureOfMerit, walkerConstellation } from '@bessel/coverage';

const fom = figureOfMerit([[10, 20], [40, 70]], [0, 100]); // percentCoverage 0.4, accessCount 2
const sats = walkerConstellation({ a: 7000, e: 0, i: 0.925, argp: 0, totalSats: 24, planes: 3, phasing: 1 });
```

Grid sweep over access:

- `GridSpec` (interface): central `body` and `bodyFrame`, latitude/longitude bounds and counts (uniform lat/lon grid), optional `altKm`.
- `GridSweepRequest` (interface): `grid`, `assets` (SPK ids/names), `span`, `step`, `minElevationRad`, optional `abcorr` and `onProgress`.
- `CoverageCell` / `CoverageGrid`: per-cell FOM of the any-asset (1-fold) union window plus `nFoldCoverage` (fraction of the span covered by at least k assets simultaneously, k = 1..N), in row-major order.
- `sweepCoverageGrid(spice, req)`: builds the lat/lon grid and, per cell, reuses `@bessel/access` `computeElevationAccess` for each asset (it does NOT duplicate the access engine), unions the assets for 1-fold coverage, reduces to a `FigureOfMerit`, and accumulates the N-fold coverage. Loud `GridSweepError` on a bad grid or empty asset list.

```ts
import { sweepCoverageGrid } from '@bessel/coverage';

const result = await sweepCoverageGrid(spice, {
  grid: { body: 'EARTH', bodyFrame: 'IAU_EARTH', latMin: -1, latMax: 1, latCount: 9, lonMin: -3.1, lonMax: 3.1, lonCount: 18 },
  assets: ['-99'], // a propagated satellite (or several, for a constellation)
  span: [t0, t1], step: 60, minElevationRad: 10 * Math.PI / 180,
});
// result.cells[k].fom and .nFoldCoverage form the Figure-of-Merit grid.
```

## Dependency rule

Depends on: `@bessel/timeline` (Window measures and algebra), `@bessel/propagator` (`ClassicalElements`), `@bessel/access` (`computeElevationAccess`, single-(point,asset) access), and `@bessel/spice` (the engine the sweep drives). Part of the core layer; imports no PAL implementation or UI.

## Algorithm and references

- FOM reduction derives gaps from the window complement over the span, then computes covered fraction, access count, and mean/max gap durations.
- Walker Delta/Star geometry: planes spaced evenly in RAAN, satellites spaced evenly in mean anomaly within a plane, with inter-plane phasing F. See Walker, J.G., "Satellite constellations" (REFERENCES.md, Coverage section).

## Tests

`packages/coverage/src/coverage.test.ts`. `figureOfMerit` is validated against hand-built interval sets with exact expected statistics (40% coverage, gap lengths 10/20/30, never-covered and full-coverage edge cases). `walkerConstellation` is validated against the structural spacing rules: a Walker Delta 53:24/3/1 (RAAN spacing 120 deg, in-plane 45 deg, inter-plane phase offset 15 deg), a Star RAAN spread over pi, and rejection of T not divisible by P.

## Status / limitations

Walker generation produces only the element sets (osculating Keplerian); it does not propagate or run the grid sweep. The FOM consumes a precomputed access `Window` and does not itself compute access.
