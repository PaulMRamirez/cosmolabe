# @bessel/sensors

Sensor field-of-view geometry and ground footprints: point-in-FOV tests, conic
boundary generation, ray/sphere and ray/ellipsoid intersection, and time-evolving
swath accumulation. A core analysis-engine package; it computes geometry while the
scene renders it. (STK_PARITY_SPEC section 4.7.)

## Public API

Pure geometry (`index.ts`):

- `offBoresightAngle(los, boresight)`, `pointInConicFov(los, boresight, halfAngleRad)`: angular tests against a circular (conic) FOV.
- `conicBoundary(boresight, halfAngleRad, samples?)`: sample the rim rays of a cone.
- `raySphereIntersect(origin, dir, center, radius)`: nearest hit, or null on a miss.
- `footprintOnSphere(apex, boresight, halfAngleRad, center, radius, samples?)`: returns a `Footprint` (surface `points` plus a `misses` limb-crossing count).
- `Vec3`, `Footprint` types.

SPICE-driven instrument footprints (`footprint-spice.ts`):

- `loadInstrumentFov(spice, instId)`: read an instrument FOV via `getfov`.
- `fovConeRim(spacecraft, target, fov, maxLengthKm)`: nadir-pointed FOV cone rim points.
- `footprintFromFov(spice, et, fov, ctx)`: intercept FOV corner rays on the target ellipsoid via `sincpt`, returning J2000 surface points (or `[]` on a limb crossing).
- `InstrumentFov`, `FootprintContext`, `Vec3Tuple` types.

Swaths (`swath.ts`):

- `accumulateSwath(samples, schema, center, radius, ringSamples?)`: per-sample footprint rings over a trajectory.
- `swathCovers(point, samples, schema)`, `swathCoverageFraction(testPoints, samples, schema)`: coverage queries.
- `SensorSchema` (conic), `SwathSample`, `Swath` types.

```ts
const fov = await loadInstrumentFov(spice, -82000);
const points = await footprintFromFov(spice, et, fov, {
  observerId: '-82', targetId: '699', targetFrame: 'IAU_SATURN',
});
```

## Dependency rule

Depends on: `@bessel/spice`. Part of the core layer; it imports only the
`SpiceEngine` interface and other core types, never a concrete PAL implementation
or the UI.

## Algorithm and references

Closed-form conic FOV geometry (angle from boresight, ray/sphere intersection)
plus SPICE toolkit primitives for the catalog-driven path: `getfov` for instrument
fields of view and `sincpt` for ray/ellipsoid surface intercepts. See REFERENCES.md,
the SPICE and NAIF section (NAIF SPICE tutorials and the CSPICE toolkit).

## Tests

Tests live in `packages/sensors/src/*.test.ts`:

- `sensors.test.ts`: conic FOV classification and boundary angles against closed
  forms, and a nadir cone whose footprint forms a circle of the analytic radius on
  a sphere.
- `footprint-spice.test.ts`: instrument FOV loading and ellipsoid footprint geometry.
- `swath.test.ts`: swath accumulation and coverage fractions.

## Status / limitations

Conic (circular) sensors only; rectangular and other FOV shapes are not yet
modeled. The pure footprint path uses a sphere, while the SPICE path uses the
target ellipsoid; either returns no points when a boundary ray crosses the limb.
