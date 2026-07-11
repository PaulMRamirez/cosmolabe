# @bessel/mission

Trajectory and maneuver design primitives (Astrogator-class): a Lambert
boundary-value solver and impulsive maneuvers expressed in the standard attitude
frames. Pure two-body math, no SPICE, no I/O. Core analysis-engine layer.

## Public API

Lambert transfer:

- `lambert(r1, r2, tof, mu, prograde = true): LambertSolution` solves the
  two-point boundary-value problem (positions in km, time of flight in seconds,
  gravitational parameter mu); returns the connecting velocities `{ v1, v2 }`.
  Throws on degenerate geometry or non-convergence.
- Types: `LambertSolution`, `Vec3`.

Impulsive maneuvers:

- `frameBasis(state, frame): FrameBasis` builds the orthonormal basis (in
  inertial coordinates) of a maneuver frame at a Cartesian state.
- `applyImpulsiveManeuver(state, dv, frame): CartesianState` rotates a
  frame-relative delta-v (km/s) into inertial and adds it to the velocity;
  position is unchanged.
- `deltaVMagnitude(dv): number`.
- Types: `CartesianState`, `ManeuverFrame` (`'J2000' | 'VNB' | 'RIC' | 'LVLH'`),
  `FrameBasis`.

```ts
import { lambert, applyImpulsiveManeuver } from '@bessel/mission';

const { v1, v2 } = lambert(r1, r2, 76 * 60, 398600.4418);
const after = applyImpulsiveManeuver(state, { x: 0.1, y: 0, z: 0 }, 'VNB');
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer; it imports no other
`@bessel` package, no PAL, and no UI.

## Tests

`packages/mission/src/mission.test.ts`. The Lambert solver is validated against
Vallado's published example 7-5 (Earth, 76 minute transfer) to roughly 1e-3
km/s, plus a closure/energy sanity case. The maneuver frames are checked against
hand-derived RIC and VNB bases (orthonormality and burn-direction effects).

## Algorithm and references

- Lambert: universal-variable formulation (Bate-Mueller-White / Vallado), single
  revolution, with bisection on the psi parameter and Stumpff functions c2/c3.
- Maneuver frames: orthonormal bases for J2000, VNB (velocity, normal,
  bi-normal), RIC (radial, in-track, cross-track / RTN), and LVLH (z toward
  nadir).
- References: Vallado, "Fundamentals of Astrodynamics and Applications" (Lambert
  and two-body); see REFERENCES.md.

## Status / limitations

First cut: single-revolution Lambert and impulsive maneuvers only. The
mission-control-sequence executor, differential correctors, and finite burns are
not implemented yet (they build on these primitives).
