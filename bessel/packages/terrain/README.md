# @bessel/terrain

Terrain-masked line-of-sight: given a digital elevation model (DEM) and a
straight observer-to-target ray in body-fixed coordinates, decide whether the
path stays clear of the terrain surface. Pure functions (the DEM is a height
function), part of the core analysis-engine layer. This feeds terrain-masked
access; surface visualization itself is an MMGIS handoff. (STK_PARITY_SPEC
§4.12.)

## Public API

- `Vec3`: a readonly `{ x, y, z }` rectangular point (km in body-fixed frame).
- `Dem`: a digital elevation model, `heightAt(lonRad, latRad) => number`,
  returning height in metres above the reference sphere.
- `terrainMaskedLos(observer, target, dem, bodyRadiusKm, samples = 256)`:
  samples the ray and returns `true` when clear, `false` when any interior
  point drops below the local surface (`bodyRadiusKm + DEM height`).
- `FLAT_DEM`: a `Dem` that is everywhere at the reference sphere, modelling
  curvature-only masking.

```ts
import { terrainMaskedLos, FLAT_DEM, type Vec3 } from '@bessel/terrain';

const R = 6371;
const a: Vec3 = { x: R + 200, y: 0, z: 0 };
const b: Vec3 = { x: (R + 200) * Math.cos(0.1), y: (R + 200) * Math.sin(0.1), z: 0 };
terrainMaskedLos(a, b, FLAT_DEM, R); // true: clear over flat terrain
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer. It imports no other
`@bessel` package and no PAL implementation, so it never reaches up the stack.

## Tests

Tests live in `packages/terrain/src/terrain.test.ts`. They check the four
qualitative cases that pin down the geometry: a clear path between two elevated
points over flat terrain; occlusion once a tall ridge rises between the
endpoints; a low ridge below the LOS that does not block it; and body curvature
alone blocking an over-horizon surface-to-surface path around the limb.

## Algorithm and references

The masking test is a sampled ray-versus-height-field intersection: the
observer-to-target segment is discretised into `samples` steps, each step's
body-fixed point is converted to spherical lon/lat/radius, and the LOS is
blocked if that radius falls below the local surface radius
(`bodyRadiusKm + dem.heightAt(lon, lat)`). This is the standard digital terrain
horizon/visibility test; geometric line-of-sight and DEM masking conventions
follow Snyder, "Map Projections: A Working Manual" (USGS Professional Paper
1395) for the spherical lon/lat geometry, with the surface-data handoff to
MMGIS (NASA-AMMOS). See `REFERENCES.md`.

## Status / limitations

Spherical reference body only (no ellipsoid flattening), with fixed-step linear
sampling, so very thin ridges can be missed below the sample count and the
result is an approximation rather than an analytic intersection.
