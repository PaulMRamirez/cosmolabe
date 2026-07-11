# @bessel/analysis

Analysis Workbench primitives: a Vector Geometry Tool (angles, projections, planes) and a typed time-series sampler with basic statistics over caller-supplied data providers. Pure core logic; geometry and SPICE reads are injected by callers, and the charting/report UI consumes the resulting Series. (STK_PARITY_SPEC §4.10.)

## Public API

Vector geometry (operating on the immutable `Vec3` interface):

- `angleBetween(a, b)`: unsigned angle in radians, robust near 0 and pi.
- `signedAngleAbout(a, b, axis)`: right-handed signed angle about an axis.
- `projection(v, axis)`: scalar component of v along axis.
- `rejection(v, axis)`: the `Vec3` component of v perpendicular to axis.
- `vectorToPlaneAngle(v, planeNormal)`: elevation above a plane (+/- pi/2 rad).

Time series (a Report/Graph data provider):

- `DataProvider = (et: number) => number` and the immutable `Series` type.
- `sampleSeries(providerId, provider, etGrid)`: evaluate a provider over an epoch grid.
- `seriesStats(series)`: min / max / mean reduction.

```ts
import { sampleSeries, seriesStats, angleBetween } from '@bessel/analysis';

const grid = Float64Array.from({ length: 5 }, (_, k) => k);
const s = sampleSeries('range', (et) => 2 * et + 1, grid);
const { min, max, mean } = seriesStats(s);
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer. It holds no SPICE state and reads no kernels; providers that supply geometry or ephemeris values are passed in by callers, so it never imports a PAL implementation or UI.

## Tests

Tests live in `packages/analysis/src/analysis.test.ts`. The Vector Geometry Tool is checked against closed-form analytic values (orthogonal vectors yield pi/2, antiparallel yields pi, a 45 degree vector yields the expected elevation, projection/rejection split a known vector). The sampler/stats are checked against an exact linear provider.

## Algorithm and references

The vector operations are standard closed-form linear algebra: `angleBetween` uses the numerically stable `atan2(|a x b|, a . b)` form, `signedAngleAbout` resolves handedness via the triple product `(a x b) . axis`, and `vectorToPlaneAngle` is `asin` of the normalized dot with the plane normal. These identities are self-validating and are not tied to an external numeric reference; see REFERENCES.md for the wider analysis-engine provenance.

## Status / limitations

Minimal but complete for the Workbench primitives it covers; no quaternion or frame-aware geometry yet, and Series sampling is scalar-only (vector or multi-channel quantities are not modeled here).
