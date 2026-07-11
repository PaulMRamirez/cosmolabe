# @bessel/events

Temporal geometry events: eclipse and lighting intervals for an observer. It
classifies the occultation of the Sun (an extended ellipsoidal body) by a
central body, as seen from a spacecraft, into umbra, penumbra, annular, and
sunlit windows. Core layer.

## Public API

- `eclipseIntervals(spice, req): Promise<EclipseIntervals>`: computes the four
  lighting windows over a span.
- `EclipseRequest`: inputs (observer id/name, eclipsing `body` and its
  `bodyFrame`, `span` of ET seconds, geometry-finder `step`, optional `abcorr`,
  and an optional `light` source that defaults to the Sun in `IAU_SUN`).
- `EclipseIntervals`: the result windows `umbra`, `penumbra`, `annular`, and
  `sunlit`; they partition the requested span.

```ts
const ecl = await eclipseIntervals(spice, {
  observer: '-82',          // Cassini
  body: 'SATURN',
  bodyFrame: 'IAU_SATURN',
  span: [t0, t1],           // ET seconds
  step: 60,
});
// ecl.umbra, ecl.penumbra, ecl.annular, ecl.sunlit are Window[] (from @bessel/timeline)
```

## Dependency rule

Depends on: `@bessel/spice`, `@bessel/timeline`. Part of the core layer (it
imports only other core packages and never a concrete PAL implementation).

## Algorithm and references

Each lighting condition is found by SPICE's occultation geometry finder
(`gfoclt`) run for the `FULL`, `PARTIAL`, and `ANNULAR` occultation types of an
ellipsoid Sun by an ellipsoid central body; the `sunlit` window is the
complement of their union over the span. See REFERENCES.md, "SPICE and NAIF":
NAIF SPICE geometry-finder (GF) subsystem and the `occult`/`gfoclt` semantics
documented for the CSPICE toolkit and the SpiceyPy binding.

## Tests

`packages/events/src/eclipse.test.ts` drives the Cassini Saturn-orbit-insertion
fixtures (de440s, cassini-soi, leapseconds, PCK). It validates the
classification against the per-epoch `occult` reference: the umbra midpoint
returns occult code -3 (Sun totally occulted), a sunlit interval returns 0, and
the four windows measure-sum to the full span.

## Status / limitations

Single function today: spacecraft eclipse and lighting only. The light source is
modeled as an ellipsoid; the partition is exact to the geometry finder's `step`
and convergence, so a coarse `step` can miss brief events.
