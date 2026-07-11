# @bessel/map-projection

Pure forward/inverse map projections for the 2D map view (orbital overlays only;
general GIS is an MMGIS handoff). All longitudes and latitudes are in radians. A
core leaf package with no dependencies.

## Public API

Constants:

- `EARTH_RADIUS_M`: WGS-84 equatorial radius (6378137 m), the Web Mercator sphere radius.
- `WEB_MERCATOR_MAX_LAT`: the Web Mercator latitude clamp (~85.05113 deg) where the map becomes square.

Types: `Point2 { x, y }` and `LonLat { lon, lat }`.

Three projection families, each with a forward and inverse function (all take an
optional `radius`, defaulting to `EARTH_RADIUS_M`):

- `equirectangularForward` / `equirectangularInverse`: Plate Carree, `x = R*lon`, `y = R*lat`.
- `webMercatorForward` / `webMercatorInverse`: spherical Web Mercator (EPSG:3857), latitude clamped to `+/-WEB_MERCATOR_MAX_LAT`.
- `polarStereographicForward` / `polarStereographicInverse`: about a pole (`1` north, `-1` south), mapping a hemisphere to a disk.

```ts
import { webMercatorForward, webMercatorInverse } from '@bessel/map-projection';

const p = webMercatorForward({ lon: Math.PI / 4, lat: 0.5 }); // { x, y } in metres
const ll = webMercatorInverse(p); // back to { lon, lat } radians
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer; it imports no other package
and no concrete PAL implementation.

## Tests

Tests live in `packages/map-projection/src/projection.test.ts`. Web Mercator is
validated against EPSG:3857 reference extents (lon = 180 deg maps to
x = 20037508.342789244 m, the world half-width) plus forward/inverse round-trips;
equirectangular and polar stereographic are checked on round-trips and pole/origin
placement.

## Algorithm and references

Equirectangular, spherical Web Mercator, and polar stereographic projections per
Snyder, "Map Projections: A Working Manual" (USGS Professional Paper 1395). See
REFERENCES.md.

## Status / limitations

Sphere-based projections only (no ellipsoidal forms); the Web Mercator far
latitudes are clamped and the polar far pole is at infinity. Intended for orbital
overlays on the 2D map view, not as a general GIS reprojection layer.
