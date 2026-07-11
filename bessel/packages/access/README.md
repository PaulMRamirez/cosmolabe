# @bessel/access

Visibility/access analysis over a time span: it computes the interval `Window` during which an observer can "see" a target, subject to a composable constraint set. Each constraint is reduced to a SPICE window (via the CSPICE geometry finders) and the windows are intersected. Core layer.

## Public API

Top-level access:

- `computeAccess(spice, req: AccessRequest): Promise<Window>` intersects the search span with each constraint's window. With no constraints the result is the whole span.
- `computeChainAccess(spice, links, span, step, abcorr?): Promise<Window>` computes multi-hop (relay) access: the intersection of every hop, so the chain is "up" only when all hops are simultaneously up.
- `AccessRequest`, `AccessLink`, `AccessConstraint`, `LineOfSightConstraint` (occultation complement, `gfoclt`), `RangeConstraint` (observer-to-target distance in `[minKm, maxKm]`, `gfdist`).

Ground-facility access (re-exported from `./facility.ts`):

- `computeElevationAccess(spice, facility, target, span, step, minElevationRad, abcorr?): Promise<Window>` finds intervals where a target is at or above a minimum elevation above the facility's local geodetic horizon.
- `Facility` (central body, body-fixed frame, geodetic lon/lat/alt).

```ts
import { computeAccess } from '@bessel/access';

const w = await computeAccess(spice, {
  observer: '-82', target: 'SUN', span: [t0, t1], step: 120,
  constraints: [{ kind: 'lineOfSight', body: 'SATURN', bodyFrame: 'IAU_SATURN' }],
});
```

## Dependency rule

Depends on: `@bessel/spice`, `@bessel/timeline`. Part of the core layer (it uses the `SpiceEngine` interface and `Window` algebra only; it imports no PAL implementation and no UI).

## Algorithm and references

Access is expressed as window algebra over SPICE geometry-finder outputs: line-of-sight is the complement of `gfoclt` occultation intervals, range is the intersection of `gfdist` distance windows, and chain/composite access is the intersection of per-constraint and per-hop windows. Elevation access uses pure ellipsoid math (geodetic-to-rectangular position and the outward geodetic normal as local up), then samples elevation in the body-fixed frame and refines crossings via the shared `findConstraintWindow` scan-and-bisection finder. Validated against CSPICE (NAIF SPICE geometry finders and `occult`); see the project [REFERENCES.md](../../REFERENCES.md) (NAIF SPICE, STK parity) and `docs/STK_PARITY_SPEC.md` §4.3.

## Tests

`packages/access/src/access.test.ts` and `packages/access/src/facility.test.ts` validate the engine end to end against CSPICE references on the Cassini SOI fixtures: line-of-sight access partitions the span with the `gfoclt` eclipse and is cross-checked with `occult`; range-access boundaries sit at the threshold distance (cross-checked with `spkpos`); composed min/max range and chain access are verified as proper subsets of their inputs.

## Status / limitations

Constraint kinds are currently line-of-sight, range, and (for facilities) elevation; richer STK-style constraints are not yet modeled. The geometry-finder `step` must be shorter than the briefest event, or short windows can be missed.
